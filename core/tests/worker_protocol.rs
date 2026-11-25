//! Exercise the real worker binaries with isolated files and persistent pipes.
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

struct Worker {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
}

impl Worker {
    fn new(archive: bool, environment_marker: Option<&Path>) -> Self {
        let mut command = Command::new(if archive {
            env!("CARGO_BIN_EXE_marketplace-archive")
        } else {
            env!("CARGO_BIN_EXE_marketplace-storage")
        });
        command
            .arg("worker")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        command.env_remove("MARKETPLACE_CORE_CANCEL_FILE");
        if let Some(marker) = environment_marker {
            command.env("MARKETPLACE_CORE_CANCEL_FILE", marker);
        }
        let mut child = command.spawn().unwrap();
        let input = child.stdin.take();
        let output = BufReader::new(child.stdout.take().unwrap());
        let mut worker = Self {
            child,
            input,
            output,
        };
        assert_eq!(worker.next(), json!({"type":"ready","protocol":1}));
        worker
    }

    fn bytes(&mut self, bytes: &[u8]) {
        self.input.as_mut().unwrap().write_all(bytes).unwrap();
        self.input.as_mut().unwrap().flush().unwrap();
    }

    fn send(&mut self, id: u64, marker: &Path, request: Value, binary: Option<&[u8]>) {
        let mut frame = json!({"requestId":id,"cancellationPath":marker,"request":request});
        if let Some(bytes) = binary {
            frame["binaryBytes"] = (bytes.len() as u64).into();
        }
        let mut header = serde_json::to_vec(&frame).unwrap();
        header.push(b'\n');
        self.bytes(&header);
        if let Some(bytes) = binary {
            self.bytes(bytes);
        }
    }

    fn next(&mut self) -> Value {
        let mut line = String::new();
        assert!(
            self.output.read_line(&mut line).unwrap() > 0,
            "worker closed stdout"
        );
        serde_json::from_str(&line).unwrap()
    }

    fn finish(mut self, success: bool) {
        drop(self.input.take());
        let mut remainder = String::new();
        assert_eq!(
            self.output.read_line(&mut remainder).unwrap(),
            0,
            "unexpected response: {remainder}"
        );
        assert_eq!(self.child.wait().unwrap().success(), success);
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(unix)]
#[test]
fn termination_exits_idle_and_partial_payload_workers_without_a_terminal_acknowledgment() {
    let fixture = tempfile::tempdir().unwrap();
    for partial_payload in [false, true] {
        let mut worker = Worker::new(false, None);
        if partial_payload {
            let header = json!({"requestId":1,"cancellationPath":fixture.path().join("cancel"),"request":{"operation":"writeFile"},"binaryBytes":1});
            worker.bytes(format!("{header}\n").as_bytes());
        }
        assert!(
            Command::new("kill")
                .arg("-TERM")
                .arg(worker.child.id().to_string())
                .status()
                .unwrap()
                .success()
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if let Some(status) = worker.child.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "idle signal did not stop the worker"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        worker.finish(true);
    }
}

#[test]
fn storage_reuses_live_pipe_for_raw_newlines_and_empty_writes() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().join("private");
    let marker = fixture.path().join("cancel");
    let target = root.join("nested/payload.bin");
    let mut worker = Worker::new(false, None);
    let payload = b"private\n\0data\n{\"requestId\":99}\n";
    worker.send(
        1,
        &marker,
        json!({"operation":"writeFile","rootDirectory":root,"filePath":target}),
        Some(payload),
    );
    assert_eq!(
        worker.next(),
        json!({"type":"result","requestId":1,"result":{"ok":true}})
    );
    assert_eq!(std::fs::read(&target).unwrap(), payload);
    worker.send(
        2,
        &marker,
        json!({"operation":"writeFile","rootDirectory":root,"filePath":target}),
        Some(b""),
    );
    assert_eq!(worker.next()["requestId"], 2);
    assert!(std::fs::read(&target).unwrap().is_empty());
    worker.send(
        3,
        &marker,
        json!({"operation":"writeFile","rootDirectory":root,"filePath":target,"dataBase64":"AQID"}),
        None,
    );
    assert_eq!(worker.next()["type"], "error");
    assert!(std::fs::read(&target).unwrap().is_empty());
    // Terminal publication guarantees operation handles/staging files are gone.
    assert_eq!(
        std::fs::read_dir(target.parent().unwrap()).unwrap().count(),
        1
    );
    std::fs::remove_dir_all(&root).unwrap();
    worker.finish(true);
}

#[test]
fn domain_error_and_cancelled_job_do_not_poison_following_requests_or_cache_roots() {
    let fixture = tempfile::tempdir().unwrap();
    let cancelled = fixture.path().join("cancelled");
    let fresh = fixture.path().join("fresh");
    std::fs::write(&cancelled, b"").unwrap();
    let mut worker = Worker::new(false, Some(&cancelled));
    worker.send(1, &cancelled, json!({"operation":"unknown"}), None);
    assert_eq!(worker.next()["error"]["code"], "CORE_CANCELLED");
    worker.send(2, &fresh, json!({"operation":"unknown"}), None);
    assert_eq!(worker.next()["error"]["code"], "CORE_INVALID_OPERATION");
    for (id, name) in [(3, "first"), (4, "second")] {
        let root = fixture.path().join(name);
        worker.send(
            id,
            &fresh,
            json!({"operation":"writeFile","rootDirectory":root,"filePath":root.join("payload")}),
            Some(name.as_bytes()),
        );
        assert_eq!(worker.next()["type"], "result");
        assert_eq!(
            std::fs::read(root.join("payload")).unwrap(),
            name.as_bytes()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    worker.finish(true);
}

#[test]
fn archive_worker_correlates_progress_and_releases_files_before_terminal() {
    use base64::Engine;
    let fixture = tempfile::tempdir().unwrap();
    let marker = fixture.path().join("cancel");
    let source = fixture.path().join("plain");
    let archive = fixture.path().join("archive");
    std::fs::write(&source, vec![42; 65537]).unwrap();
    let key = base64::engine::general_purpose::STANDARD.encode([7; 32]);
    let mut worker = Worker::new(true, None);
    let manifest = json!({"version":3,"createdAt":"2026-11-24T10:00:00.000Z","appVersion":"test","includesStorage":false});
    worker.send(
        1,
        &marker,
        json!({"operation":"create","key":key,"databaseDumpPath":source,"destinationPath":archive,"manifest":manifest}),
        None,
    );
    loop {
        let message = worker.next();
        assert_eq!(message["requestId"], 1);
        if message["type"] != "progress" {
            assert_eq!(message["type"], "result");
            break;
        }
    }
    std::fs::remove_file(&source).unwrap();
    worker.send(
        2,
        &marker,
        json!({"operation":"authenticate","key":key,"sourcePath":archive}),
        None,
    );
    let mut progress = 0;
    loop {
        let message = worker.next();
        assert_eq!(message["requestId"], 2);
        if message["type"] == "progress" {
            progress += 1;
        } else {
            assert_eq!(message["type"], "result");
            break;
        }
    }
    assert!(progress > 0);
    std::fs::remove_file(&archive).unwrap();
    worker.send(
        3,
        &marker,
        json!({"operation":"validateKey","key":key}),
        None,
    );
    assert_eq!(
        worker.next(),
        json!({"type":"result","requestId":3,"result":null})
    );
    worker.finish(true);
}

#[test]
fn malformed_or_truncated_frames_never_acknowledge_or_mutate_and_never_resynchronize() {
    let fixture = tempfile::tempdir().unwrap();
    let marker = fixture.path().join("cancel");
    let root = fixture.path().join("private");
    let request =
        json!({"operation":"writeFile","rootDirectory":root,"filePath":root.join("payload")});
    for malformed in [
        b"not-json\n".to_vec(),
        serde_json::to_vec(&json!({"requestId":1,"cancellationPath":marker,"request":request})).unwrap(),
        format!("{}\n",json!({"requestId":2,"cancellationPath":marker,"request":request})).into_bytes(),
        format!("{}\n",json!({"requestId":1,"cancellationPath":marker,"request":request,"binaryBytes":8388609})).into_bytes(),
        format!("{}\nx",json!({"requestId":1,"cancellationPath":marker,"request":request,"binaryBytes":2})).into_bytes(),
        format!("{}\n",json!({"requestId":1,"cancellationPath":marker,"request":request,"binaryBytes":0,"extra":true})).into_bytes(),
    ] {
        let mut worker = Worker::new(false,None);
        worker.bytes(&malformed);
        worker.finish(false);
        assert!(!root.exists());
    }
    let mut worker = Worker::new(false, None);
    worker.send(1, &marker, json!({"operation":"unknown"}), None);
    assert_eq!(worker.next()["error"]["code"], "CORE_INVALID_OPERATION");
    worker.send(1, &marker, request, Some(b""));
    worker.finish(false);
    assert!(!root.exists());
    let mut worker = Worker::new(true, None);
    worker.send(1, &marker, json!({"operation":"validateKey"}), Some(b""));
    worker.finish(false);
}

#[test]
fn raw_payload_accepts_the_exact_eight_mebibyte_limit() {
    let fixture = tempfile::tempdir().unwrap();
    let marker = fixture.path().join("cancel");
    let root = fixture.path().join("private");
    let target = root.join("payload");
    let payload = vec![71; 8 * 1024 * 1024];
    let mut worker = Worker::new(false, None);
    worker.send(
        1,
        &marker,
        json!({"operation":"writeFile","rootDirectory":root,"filePath":target}),
        Some(&payload),
    );
    assert_eq!(worker.next()["type"], "result");
    assert_eq!(std::fs::read(target).unwrap(), payload);
    worker.finish(true);
}

#[test]
fn background_binary_results_preserve_migration_and_empty_or_missing_files() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().join("private");
    let legacy_root = fixture.path().join("legacy");
    std::fs::create_dir(&legacy_root).unwrap();
    let legacy = legacy_root.join("background");
    let target = root.join("nested/background");
    let payload = b"\nprivate\0\n{\"type\":\"result\"}\n";
    std::fs::write(&legacy, payload).unwrap();
    let request = json!({"operation":"readBackgroundRepresentation","rootDirectory":root,"directoryPath":root.join("nested"),"filePath":target,"legacyPath":legacy,"legacyRoot":legacy_root});
    let mut worker = Worker::new(false, None);
    let marker = fixture.path().join("cancel");
    worker.send(1, &marker, request.clone(), None);
    let migrated = worker.next();
    assert_eq!(migrated["type"], "binaryResult");
    assert_eq!(migrated["requestId"], 1);
    assert_eq!(migrated["binaryBytes"], payload.len());
    assert_eq!(migrated["version"].as_str().unwrap().len(), 64);
    let mut actual = vec![0; payload.len()];
    worker.output.read_exact(&mut actual).unwrap();
    assert_eq!(actual, payload);
    assert!(!legacy.exists());
    assert_eq!(std::fs::read(&target).unwrap(), payload);
    // Files are closed before the terminal header, including on Windows.
    std::fs::write(&target, b"").unwrap();
    worker.send(2, &marker, request.clone(), None);
    let empty = worker.next();
    assert_eq!(empty["type"], "binaryResult");
    assert_eq!(empty["requestId"], 2);
    assert_eq!(empty["binaryBytes"], 0);
    assert_ne!(empty["version"], migrated["version"]);
    std::fs::remove_file(&target).unwrap();
    worker.send(3, &marker, request, None);
    assert_eq!(
        worker.next(),
        json!({"type":"result","requestId":3,"result":null})
    );
    std::fs::remove_dir_all(root).unwrap();
    worker.finish(true);
}

#[test]
fn background_metadata_and_versioned_binary_share_one_file_version() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().join("private");
    let legacy_root = fixture.path().join("legacy");
    std::fs::create_dir(&legacy_root).unwrap();
    let legacy = legacy_root.join("background");
    let target = root.join("nested/background");
    let payload = b"abc\0";
    std::fs::write(&legacy, payload).unwrap();
    let mut request = json!({"operation":"statBackground","rootDirectory":root,"directoryPath":root.join("nested"),"filePath":target,"legacyPath":legacy,"legacyRoot":legacy_root});
    let mut worker = Worker::new(false, None);
    let marker = fixture.path().join("cancel");

    worker.send(1, &marker, request.clone(), None);
    let first = worker.next();
    assert_eq!(first["type"], "result");
    assert_eq!(first["result"]["size"], payload.len());
    let version = first["result"]["version"].as_str().unwrap();
    assert_eq!(version.len(), 64);
    assert!(!legacy.exists());

    request["operation"] = "readBackgroundRepresentation".into();
    worker.send(2, &marker, request.clone(), None);
    assert_eq!(
        worker.next(),
        json!({"type":"binaryResult","requestId":2,"binaryBytes":payload.len(),"version":version})
    );
    let mut actual = [0; 4];
    worker.output.read_exact(&mut actual).unwrap();
    assert_eq!(&actual, payload);

    worker.send(
        3,
        &marker,
        json!({"operation":"writeFile","rootDirectory":root,"filePath":target}),
        Some(b"new\n"),
    );
    assert_eq!(worker.next()["type"], "result");
    worker.send(4, &marker, request.clone(), None);
    let second = worker.next();
    let new_version = second["version"].as_str().unwrap();
    assert_ne!(new_version, version);
    assert_eq!(second["binaryBytes"], payload.len());
    worker.output.read_exact(&mut actual).unwrap();
    assert_eq!(&actual, b"new\n");

    request["operation"] = "statBackground".into();
    worker.send(5, &marker, request, None);
    assert_eq!(
        worker.next(),
        json!({"type":"result","requestId":5,"result":{"version":new_version,"size":payload.len()}})
    );
    worker.finish(true);
}

#[test]
fn branding_raw_frame_metadata_fails_before_mutation_and_without_resynchronization() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().join("public");
    let marker = fixture.path().join("cancel");
    for (lengths, total) in [
        (json!([1, 1, 1]), 2),
        (json!([0, 1, 1]), 2),
        (json!([8388609, 1, 1]), 8388611),
        (json!([1, 1, 1]), 25165825),
    ] {
        let mut worker = Worker::new(false, None);
        let header = json!({"requestId":1,"cancellationPath":marker,"request":{"operation":"brandingPublish","rootDirectory":root,"binaryLengths":lengths},"binaryBytes":total});
        worker.bytes(format!("{header}\n").as_bytes());
        worker.finish(false);
        assert!(!root.exists());
    }
    let mut worker = Worker::new(false, None);
    worker.send(
        1,
        &marker,
        json!({"operation":"brandingPublish","rootDirectory":root,"binaryLengths":[1,1,1]}),
        Some(b"ab"),
    );
    worker.finish(false);
    assert!(!root.exists());
    let mut worker = Worker::new(false, None);
    let header = json!({"requestId":1,"cancellationPath":marker,"request":{"operation":"brandingPublish","rootDirectory":root,"binaryLengths":[1,1,1]},"binaryBytes":3});
    worker.bytes(format!("{header}\nab").as_bytes());
    worker.finish(false);
    assert!(!root.exists());
}

#[cfg(unix)]
#[test]
fn raw_write_rejects_a_symlinked_root_without_following_it() {
    let fixture = tempfile::tempdir().unwrap();
    let outside = fixture.path().join("outside");
    let root = fixture.path().join("link");
    std::fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, &root).unwrap();
    let mut worker = Worker::new(false, None);
    worker.send(
        1,
        &fixture.path().join("cancel"),
        json!({"operation":"writeFile","rootDirectory":root,"filePath":root.join("payload")}),
        Some(b"private"),
    );
    assert_eq!(worker.next()["type"], "error");
    assert!(std::fs::read_dir(outside).unwrap().next().is_none());
    worker.finish(true);
}
