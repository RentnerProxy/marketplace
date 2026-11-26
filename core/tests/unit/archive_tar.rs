use super::*;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender, TryRecvError, channel};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(10);
const KEY: [u8; 32] = [7; 32];
const DATABASE: &[u8] = b"db";

#[test]
fn portable_paths_reject_traversal_windows_devices_and_ambiguous_segments() {
    for path in [
        "../database.dump",
        "/storage/file",
        "storage/../file",
        "storage/./file",
        "storage//file",
        "storage/CON.txt",
        "storage/com¹.txt",
        "storage/LPT9",
        "storage/file.",
        "storage/file ",
        "storage/a:b",
        "storage/a\\b",
        "storage/\u{fffd}",
        "storage/a\0b",
        "storage/a?b",
        "unexpected",
    ] {
        assert!(
            validate_entry(path, 0, "file").is_err(),
            "accepted {path:?}"
        );
    }
    let normalized = validate_entry("storage/O\u{308}lbild.txt", 0, "file").unwrap();
    assert_eq!(normalized.path, "storage/Ölbild.txt");
    assert!(validate_entry("storage", 1, "directory").is_err());
}

struct Fixture {
    _directory: tempfile::TempDir,
    source: PathBuf,
    destination: PathBuf,
    manifest: Value,
}

fn append_entry(
    bytes: &mut Vec<u8>,
    integrity: &mut Integrity,
    path: &str,
    body: &[u8],
    kind: &str,
) {
    let entry = validate_entry(path, body.len() as u64, kind).unwrap();
    integrity.start(&entry);
    integrity.update(body);
    write_header(bytes, &entry, 1_700_000_000).unwrap();
    bytes.extend_from_slice(body);
    write_padding(bytes, entry.size).unwrap();
}

fn fixture(storage_files: usize) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("archive.tar");
    let destination = directory.path().join("extracted");
    let manifest = json!({
        "version": 2,
        "createdAt": "2026-11-10T09:00:00.000Z",
        "appVersion": "test",
        "includesStorage": storage_files > 0,
    });
    let mut bytes = Vec::new();
    let mut integrity = Integrity::new(&KEY);
    append_entry(
        &mut bytes,
        &mut integrity,
        "database.dump",
        DATABASE,
        "file",
    );
    if storage_files > 0 {
        append_entry(&mut bytes, &mut integrity, "storage", b"", "directory");
        for index in 0..storage_files {
            append_entry(
                &mut bytes,
                &mut integrity,
                &format!("storage/{index}.bin"),
                &vec![index as u8; index + 3],
                "file",
            );
        }
    }
    append_entry(
        &mut bytes,
        &mut integrity,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
        "file",
    );
    let expected = serde_json::to_vec(&integrity.finish()).unwrap();
    let entry = validate_entry("integrity.json", expected.len() as u64, "file").unwrap();
    write_header(&mut bytes, &entry, 1_700_000_000).unwrap();
    bytes.extend_from_slice(&expected);
    write_padding(&mut bytes, entry.size).unwrap();
    bytes.extend_from_slice(&[0; 1024]);
    fs::write(&source, bytes).unwrap();
    Fixture {
        _directory: directory,
        source,
        destination,
        manifest,
    }
}

#[derive(Clone)]
struct WorkerLife {
    entered: Sender<()>,
    exited: Sender<()>,
}

impl WorkerLife {
    fn enter(&self) {
        self.entered.send(()).unwrap();
    }
}

impl Drop for WorkerLife {
    fn drop(&mut self) {
        let _ = self.exited.send(());
    }
}

type Completion = (CoreResult<Value>, io::Result<()>);

struct Running {
    entered: Receiver<()>,
    exited: Receiver<()>,
    completion: Receiver<Completion>,
    release: Arc<(Mutex<bool>, Condvar)>,
    thread: Option<JoinHandle<()>>,
}

impl Running {
    fn wait_for_drain(&self) {
        self.entered.recv_timeout(TIMEOUT).unwrap();
        // The original callback and three idle worker clones have dropped.
        // Therefore the parser closed every input sender and reached drain;
        // the sole payload worker still owns its gated file handle.
        for _ in 0..4 {
            self.exited.recv_timeout(TIMEOUT).unwrap();
        }
        assert!(matches!(
            self.completion.try_recv(),
            Err(TryRecvError::Empty)
        ));
    }

    fn open_gate(&self) {
        let (released, ready) = &*self.release;
        *released.lock().unwrap() = true;
        ready.notify_all();
    }

    fn finish(mut self) -> Completion {
        self.open_gate();
        let completion = self.completion.recv_timeout(TIMEOUT).unwrap();
        self.thread.take().unwrap().join().unwrap();
        completion
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        // Assertion unwinding must also release and join the extraction.
        self.open_gate();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn blocked_extraction(fixture: &Fixture, request: Value, context: OperationContext) -> Running {
    let source = fixture.source.clone();
    let destination = fixture.destination.clone();
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let gate = release.clone();
    let (entered, starts) = channel();
    let (exited, exits) = channel();
    let life = WorkerLife { entered, exited };
    let (completed, completion) = channel();
    let thread = std::thread::spawn(move || {
        let result = process_with_sync(
            &source,
            &KEY,
            Some(&destination),
            &request,
            &context,
            || {
                FileSync::new(move |file: cap_std::fs::File| {
                    life.enter();
                    let (released, ready) = &*gate;
                    let (released, _) = ready
                        .wait_timeout_while(released.lock().unwrap(), TIMEOUT, |open| !*open)
                        .unwrap();
                    if !*released {
                        return Err(io::ErrorKind::TimedOut.into());
                    }
                    drop(released);
                    // The gate models a pending sync while the worker owns the file.
                    drop(file);
                    Ok(())
                })
            },
        );
        // Model the caller's cleanup immediately after any process result.
        let cleanup = fs::remove_dir_all(&destination);
        completed.send((result, cleanup)).unwrap();
    });
    Running {
        entered: starts,
        exited: exits,
        completion,
        release,
        thread: Some(thread),
    }
}

#[test]
fn validation_does_not_start_durability_workers() {
    let fixture = fixture(1);
    let manifest = process_with_sync(
        &fixture.source,
        &KEY,
        None,
        &json!({}),
        &OperationContext::cleanup(),
        || panic!("validation must not start extraction workers"),
    )
    .unwrap();
    assert_eq!(manifest, fixture.manifest);
    assert!(!fixture.destination.exists());
}

#[test]
fn extraction_syncs_every_payload_and_closes_handles_before_success() {
    let fixture = fixture(5);
    let completed = Arc::new(Mutex::new(Vec::new()));
    let observed = completed.clone();
    let manifest = process_with_sync(
        &fixture.source,
        &KEY,
        Some(&fixture.destination),
        &json!({}),
        &OperationContext::cleanup(),
        || {
            FileSync::new(move |file: cap_std::fs::File| {
                let length = file.metadata()?.len();
                file.sync_all()?;
                drop(file);
                observed.lock().unwrap().push(length);
                Ok(())
            })
        },
    )
    .unwrap();
    assert_eq!(manifest, fixture.manifest);
    let mut lengths = completed.lock().unwrap().clone();
    lengths.sort_unstable();
    assert_eq!(lengths, vec![2, 3, 4, 5, 6, 7]);
    assert_eq!(
        fs::read(fixture.destination.join("database.dump")).unwrap(),
        DATABASE
    );
    for index in 0..5 {
        assert_eq!(
            fs::read(fixture.destination.join(format!("storage/{index}.bin"))).unwrap(),
            vec![index as u8; index + 3],
        );
    }
    fs::remove_dir_all(&fixture.destination).unwrap();
}

#[test]
fn source_identity_is_checked_after_the_last_sync_finishes() {
    let fixture = fixture(0);
    let running = blocked_extraction(&fixture, json!({}), OperationContext::cleanup());
    running.wait_for_drain();
    let source = fs::OpenOptions::new()
        .write(true)
        .open(&fixture.source)
        .unwrap();
    source
        .set_len(source.metadata().unwrap().len() + 1)
        .unwrap();
    drop(source);
    let (result, cleanup) = running.finish();
    let error = result.unwrap_err();
    assert_eq!(error.code, "ARCHIVE_INVALID");
    assert!(error.message.contains("Größe"));
    cleanup.unwrap();
    assert!(!fixture.destination.exists());
}

#[test]
fn cancellation_during_final_sync_waits_for_handles_before_returning() {
    let fixture = fixture(0);
    let context = OperationContext::cleanup();
    let running = blocked_extraction(&fixture, json!({}), context.clone());
    running.wait_for_drain();
    context.cancel();
    let (result, cleanup) = running.finish();
    assert_eq!(result.unwrap_err().code, "CORE_CANCELLED");
    cleanup.unwrap();
    assert!(!fixture.destination.exists());
}

#[test]
fn corrupt_padding_drains_started_syncs_before_caller_cleanup() {
    let fixture = fixture(0);
    let mut bytes = fs::read(&fixture.source).unwrap();
    bytes[512 + DATABASE.len()] = 1;
    fs::write(&fixture.source, bytes).unwrap();
    let running = blocked_extraction(&fixture, json!({}), OperationContext::cleanup());
    running.wait_for_drain();
    let (result, cleanup) = running.finish();
    let error = result.unwrap_err();
    assert_eq!(error.code, "ARCHIVE_INVALID");
    assert!(error.message.contains("Padding"));
    cleanup.unwrap();
    assert!(!fixture.destination.exists());
}

#[test]
fn exhausted_write_budget_drains_earlier_payload_syncs_before_cleanup() {
    let fixture = fixture(1);
    let running = blocked_extraction(
        &fixture,
        json!({"maximumWriteBytes": DATABASE.len()}),
        OperationContext::cleanup(),
    );
    running.wait_for_drain();
    let (result, cleanup) = running.finish();
    assert_eq!(result.unwrap_err().code, "ARCHIVE_BUDGET_EXCEEDED");
    cleanup.unwrap();
    assert!(!fixture.destination.exists());
}
