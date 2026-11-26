use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    time::{Duration, Instant},
};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/restore-journal-v1.json")).unwrap()
}

fn assert_events(path: &std::path::Path, expected: &[&str]) {
    let source = fs::read_to_string(path).unwrap();
    assert!(source.ends_with('\n'));
    let entries: Vec<Value> = source
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(entries.len(), expected.len());
    for (index, (record, event)) in entries.iter().zip(expected).enumerate() {
        assert_eq!(record["event"], *event);
        assert_eq!(record["sequence"], index + 1);
        if index > 0 {
            assert_eq!(
                record["previousHmacSha256"],
                entries[index - 1]["hmacSha256"]
            );
        }
    }
}

struct Session {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
    request_id: u64,
}
impl Session {
    fn spawn() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_marketplace-storage"))
            .arg("journal-session")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let input = child.stdin.take();
        let output = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            input,
            output,
            request_id: 0,
        }
    }
    fn request(&mut self, mut value: Value) -> Value {
        self.request_id += 1;
        value["requestId"] = json!(self.request_id);
        writeln!(self.input.as_mut().unwrap(), "{value}").unwrap();
        self.input.as_mut().unwrap().flush().unwrap();
        self.read()
    }
    fn read(&mut self) -> Value {
        let mut line = String::new();
        assert!(self.output.read_line(&mut line).unwrap() > 0);
        let mut response: Value = serde_json::from_str(&line).unwrap();
        response.as_object_mut().unwrap().remove("requestId");
        response
    }
    fn append(&mut self, event: &str) -> Value {
        self.request(json!({"operation":"journalAppend","event":event}))
    }
    fn close(&mut self) -> Value {
        let result = self.request(json!({"operation":"journalClose"}));
        assert!(self.child.wait().unwrap().success());
        result
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        // An error acknowledgement precedes process exit. Closing stdin and
        // awaiting that exit lets the instrumented child flush its profile;
        // killing immediately can truncate the coverage file mid-write.
        drop(self.input.take());
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                _ => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        // Teardown remains bounded, but an actual hang must still fail a test.
        assert!(
            std::thread::panicking(),
            "Der native Journal-Testprozess wurde nicht rechtzeitig beendet."
        );
    }
}
fn start(root: &std::path::Path) -> (Session, std::path::PathBuf) {
    let f = fixture();
    let mut session = Session::spawn();
    let result=session.request(json!({"operation":"journalStart","backupDirectory":root.join("backup"),"storageDirectory":root.join("storage"),"binding":f["binding"],"masterKeyBase64":f["masterKeyBase64"]}));
    assert_eq!(result, json!({"type":"result","result":{"ok":true}}));
    (
        session,
        root.join("backup/.restore-journal-v1").join(format!(
            "{}.jsonl",
            f["binding"]["restoreRunId"].as_str().unwrap()
        )),
    )
}

#[test]
fn malformed_binding_and_key_reject_before_resources() {
    let root = tempfile::tempdir().unwrap();
    let f = fixture();
    for field in [
        "restoreRunId",
        "actorUserId",
        "sourceBackupId",
        "sourceChecksumSha256",
        "extra",
    ] {
        let mut binding = f["binding"].clone();
        binding[field] = json!("../outside");
        let mut session = Session::spawn();
        assert_eq!(session.request(json!({"operation":"journalStart","binding":binding,"masterKeyBase64":f["masterKeyBase64"],"backupDirectory":root.path().join("backup"),"storageDirectory":root.path().join("storage")}))["type"],"error");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
    for key in [
        "",
        "bad",
        "AAAA",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ] {
        let mut session = Session::spawn();
        assert_eq!(session.request(json!({"operation":"journalStart","binding":f["binding"],"masterKeyBase64":key,"backupDirectory":root.path().join("backup"),"storageDirectory":root.path().join("storage")}))["type"],"error");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
}

#[test]
fn retained_session_fsyncs_chained_events_and_exclusive_evidence() {
    let root = tempfile::tempdir().unwrap();
    let (mut session, path) = start(root.path());
    let mut events = vec!["started"];
    assert_events(&path, &events);
    for event in ["rewind-ready", "applied", "completed", "recovery-required"] {
        assert_eq!(session.append(event)["type"], "result");
        events.push(event);
        assert_events(&path, &events);
    }
    assert_eq!(session.close()["type"], "result");
    let evidence = fs::read(&path).unwrap();
    let mut duplicate = Session::spawn();
    let f = fixture();
    assert_eq!(duplicate.request(json!({"operation":"journalStart","backupDirectory":root.path().join("backup"),"storageDirectory":root.path().join("storage"),"binding":f["binding"],"masterKeyBase64":f["masterKeyBase64"]}))["type"],"error");
    assert_eq!(fs::read(path).unwrap(), evidence);
}

#[test]
fn invalid_transition_permanently_fails_session_and_retains_partial_evidence() {
    for sequence in [
        vec!["applied"],
        vec!["rewind-ready", "rewind-ready"],
        vec!["failed", "completed"],
        vec!["failed", "recovery-required", "completed"],
        vec!["rewind-ready", "applied", "completed", "failed"],
    ] {
        let root = tempfile::tempdir().unwrap();
        let (mut session, path) = start(root.path());
        for event in &sequence[..sequence.len() - 1] {
            assert_eq!(session.append(event)["type"], "result");
        }
        let before = fs::read(&path).unwrap();
        assert_eq!(session.append(sequence.last().unwrap())["type"], "error");
        assert!(!session.child.wait().unwrap().success());
        assert_eq!(fs::read(&path).unwrap(), before);
    }
}

#[test]
fn detects_same_inode_truncation_extension_and_authenticated_rewrite_on_append_and_close() {
    for attack in ["truncate", "extend", "rewrite"] {
        for close in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let (mut session, path) = start(root.path());
            let mut bytes = fs::read(&path).unwrap();
            match attack {
                "truncate" => {
                    bytes.pop();
                }
                "extend" => bytes.push(b' '),
                _ => {
                    bytes = STANDARD
                        .decode(fixture()["contentBase64"].as_str().unwrap())
                        .unwrap()
                        .split(|byte| *byte == b'\n')
                        .next()
                        .unwrap()
                        .to_vec();
                    bytes.push(b'\n');
                }
            }
            // Some Windows handle policies prevent external writes entirely.
            if fs::write(&path, &bytes).is_ok() {
                let result = if close {
                    session.request(json!({"operation":"journalClose"}))
                } else {
                    session.append("rewind-ready")
                };
                assert_eq!(result["type"], "error");
                assert!(!session.child.wait().unwrap().success());
            }
        }
    }
}

#[test]
fn detects_added_hardlink() {
    let root = tempfile::tempdir().unwrap();
    let (mut session, path) = start(root.path());
    if fs::hard_link(&path, root.path().join("linked")).is_ok() {
        assert_eq!(session.append("rewind-ready")["type"], "error");
    }
}

#[cfg(unix)]
#[test]
fn rejects_file_and_directory_replacement_symlinks_and_unsafe_modes() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    for attack in [
        "file",
        "directory",
        "file-symlink",
        "directory-symlink",
        "file-mode",
        "directory-mode",
    ] {
        let root = tempfile::tempdir().unwrap();
        let (mut session, path) = start(root.path());
        let directory = path.parent().unwrap();
        match attack {
            "file" => {
                fs::rename(&path, root.path().join("original")).unwrap();
                fs::write(&path, fs::read(root.path().join("original")).unwrap()).unwrap();
                fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
            }
            "directory" => {
                fs::rename(directory, root.path().join("original")).unwrap();
                fs::create_dir(directory).unwrap();
                fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).unwrap();
            }
            "file-symlink" => {
                fs::rename(&path, root.path().join("original")).unwrap();
                symlink(root.path().join("original"), &path).unwrap();
            }
            "directory-symlink" => {
                fs::rename(directory, root.path().join("original")).unwrap();
                symlink(root.path().join("original"), directory).unwrap();
            }
            "file-mode" => fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap(),
            _ => fs::set_permissions(directory, fs::Permissions::from_mode(0o744)).unwrap(),
        }
        assert_eq!(session.append("rewind-ready")["type"], "error", "{attack}");
    }
}

#[test]
fn disconnect_before_close_fails_without_repairing_evidence() {
    let root = tempfile::tempdir().unwrap();
    let (mut session, path) = start(root.path());
    let before = fs::read(&path).unwrap();
    drop(session.input.take());
    assert_eq!(session.read()["type"], "error");
    assert!(!session.child.wait().unwrap().success());
    assert_eq!(fs::read(path).unwrap(), before);
}

#[test]
fn every_permitted_failure_and_recovery_transition_is_durable() {
    for events in [
        vec!["recovery-required"],
        vec!["failed", "recovery-required"],
        vec!["rewind-ready", "failed", "recovery-required"],
        vec!["rewind-ready", "recovery-required"],
        vec!["rewind-ready", "applied", "failed", "recovery-required"],
        vec!["rewind-ready", "applied", "recovery-required"],
    ] {
        let root = tempfile::tempdir().unwrap();
        let (mut session, path) = start(root.path());
        for event in &events {
            assert_eq!(session.append(event)["type"], "result");
        }
        session.close();
        assert_events(&path, &[vec!["started"], events].concat());
    }
}

#[test]
fn driver_rejects_malformed_partial_oversized_and_unrecognized_start_records() {
    for bytes in [
        b"{\n".to_vec(),
        b"{}".to_vec(),
        vec![b'x'; 65537],
        b"{\"operation\":\"other\",\"requestId\":1}\n".to_vec(),
        b"{\"operation\":\"journalStart\"}\n".to_vec(),
        b"{\"operation\":\"journalStart\",\"requestId\":2}\n".to_vec(),
    ] {
        let mut session = Session::spawn();
        session.input.as_mut().unwrap().write_all(&bytes).unwrap();
        drop(session.input.take());
        assert_eq!(session.read()["type"], "error");
        assert!(!session.child.wait().unwrap().success());
    }
}

#[test]
fn driver_rejects_stale_ids_extra_fields_wrong_operations_and_nonstring_events() {
    for request in [
        json!({"operation":"journalAppend","event":"rewind-ready","requestId":1}),
        json!({"operation":"journalAppend","event":"rewind-ready"}),
        json!({"operation":"journalAppend","event":"rewind-ready","extra":true,"requestId":2}),
        json!({"operation":"journalClose","extra":true,"requestId":2}),
        json!({"operation":"journalAppend","event":42,"requestId":2}),
        json!({"operation":"unknown","requestId":2}),
    ] {
        let root = tempfile::tempdir().unwrap();
        let (mut session, path) = start(root.path());
        let before = fs::read(&path).unwrap();
        writeln!(session.input.as_mut().unwrap(), "{request}").unwrap();
        session.input.as_mut().unwrap().flush().unwrap();
        assert_eq!(session.read()["type"], "error");
        assert!(!session.child.wait().unwrap().success());
        assert_eq!(fs::read(path).unwrap(), before);
    }
}
