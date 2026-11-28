use marketplace_core::{protocol::OperationContext, storage::execute};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn request(temp: &Path, names: Value) -> Value {
    json!({"operation":"backupDeleteFiles","backupDirectory":temp.join("backups"),"storageDirectory":temp.join("storage"),"fileNames":names})
}

fn create_backup_directory(parent: &Path) -> PathBuf {
    let backup = parent.join("backups");
    #[allow(unused_mut)]
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&backup).unwrap();
    backup
}

#[test]
fn deletes_regular_files_and_accepts_absent_files_and_empty_batches() {
    let temp = tempfile::tempdir().unwrap();
    let backup = create_backup_directory(temp.path());
    for name in ["a.tar", "b.tar"] {
        fs::write(backup.join(name), b"backup").unwrap();
    }
    assert_eq!(
        execute(
            request(temp.path(), json!(["a.tar", "missing.tar", "b.tar"])),
            &OperationContext::cleanup()
        )
        .unwrap(),
        json!({"ok":true})
    );
    assert!(fs::read_dir(&backup).unwrap().next().is_none());
    for names in [json!([]), json!(["a.tar", "b.tar"])] {
        assert_eq!(
            execute(request(temp.path(), names), &OperationContext::cleanup()).unwrap(),
            json!({"ok":true})
        );
    }
}

#[test]
fn validates_the_complete_name_batch_before_root_io_or_any_unlink() {
    for names in [
        json!(["valid.tar", "../outside"]),
        json!(["valid.tar", "a/b"]),
        json!(["valid.tar", "a\\b"]),
        json!(["valid.tar", ""]),
        json!(["valid.tar", "."]),
        json!(["valid.tar", ".."]),
        json!(["valid.tar", "ä.tar"]),
        json!(["valid.tar", 12]),
        json!(["valid.tar", "valid.tar"]),
        json!(["valid.tar", "x".repeat(256)]),
        json!(vec!["x"; 1025]),
        Value::Null,
    ] {
        let temp = tempfile::tempdir().unwrap();
        let error = execute(
            request(temp.path(), names.clone()),
            &OperationContext::cleanup(),
        )
        .unwrap_err();
        assert!(matches!(
            error.code.as_str(),
            "BACKUP_INVALID_NAME" | "STORAGE_INVALID"
        ));
        assert!(!temp.path().join("backups").exists());
        assert!(!temp.path().join("storage").exists());
        create_backup_directory(temp.path());
        fs::write(temp.path().join("backups/valid.tar"), b"preserved").unwrap();
        assert!(execute(request(temp.path(), names), &OperationContext::cleanup()).is_err());
        assert_eq!(
            fs::read(temp.path().join("backups/valid.tar")).unwrap(),
            b"preserved"
        );
    }
}

#[test]
fn prevalidates_all_file_types_and_hardlinks_before_unlink() {
    let temp = tempfile::tempdir().unwrap();
    let root = create_backup_directory(temp.path());
    fs::write(root.join("valid.tar"), b"preserved").unwrap();
    fs::create_dir(root.join("directory")).unwrap();
    fs::write(root.join("linked.tar"), b"linked").unwrap();
    fs::hard_link(root.join("linked.tar"), root.join("alias.tar")).unwrap();
    for invalid in ["directory", "linked.tar"] {
        assert_eq!(
            execute(
                request(temp.path(), json!(["valid.tar", invalid])),
                &OperationContext::cleanup()
            )
            .unwrap_err()
            .code,
            "STORAGE_INVALID"
        );
        assert_eq!(fs::read(root.join("valid.tar")).unwrap(), b"preserved");
    }
}

#[test]
fn cancelled_requests_preserve_files() {
    let temp = tempfile::tempdir().unwrap();
    create_backup_directory(temp.path());
    fs::write(temp.path().join("backups/a.tar"), b"preserved").unwrap();
    let context = OperationContext::cleanup();
    context.cancel();
    assert_eq!(
        execute(request(temp.path(), json!(["a.tar"])), &context)
            .unwrap_err()
            .code,
        "CORE_CANCELLED"
    );
    assert_eq!(
        fs::read(temp.path().join("backups/a.tar")).unwrap(),
        b"preserved"
    );
}

#[cfg(windows)]
#[test]
fn later_unlink_failure_is_uncertain_without_retrying_or_removing_the_locked_file() {
    use std::os::windows::fs::OpenOptionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = create_backup_directory(temp.path());
    fs::write(root.join("first.tar"), b"first").unwrap();
    fs::write(root.join("locked.tar"), b"locked").unwrap();
    // Allow normal reads/writes, but deny delete sharing for this externally
    // owned handle. Metadata prevalidation succeeds; only the second unlink fails.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0x00000001 | 0x00000002)
        .open(root.join("locked.tar"))
        .unwrap();
    assert_eq!(
        execute(
            request(temp.path(), json!(["first.tar", "locked.tar"])),
            &OperationContext::cleanup()
        )
        .unwrap_err()
        .code,
        "CORE_OPERATION_UNCERTAIN"
    );
    assert!(!root.join("first.tar").exists());
    assert_eq!(fs::read(root.join("locked.tar")).unwrap(), b"locked");
    drop(held);
}

#[cfg(windows)]
#[test]
fn windows_alias_names_are_rejected_before_root_io() {
    for names in [
        json!(["a.tar", "A.tar"]),
        json!(["CON.tar"]),
        json!(["a."]),
        json!(["LPT1"]),
    ] {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(
            execute(request(temp.path(), names), &OperationContext::cleanup())
                .unwrap_err()
                .code,
            "BACKUP_INVALID_NAME"
        );
        assert!(!temp.path().join("backups").exists());
    }
}

#[cfg(unix)]
#[test]
fn rejects_symlink_files_roots_and_exchanged_roots_on_fresh_invocations() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = create_backup_directory(temp.path());
    fs::write(root.join("valid.tar"), b"preserved").unwrap();
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("outside.tar"), b"outside").unwrap();
    symlink(outside.join("outside.tar"), root.join("escape.tar")).unwrap();
    assert!(
        execute(
            request(temp.path(), json!(["valid.tar", "escape.tar"])),
            &OperationContext::cleanup()
        )
        .is_err()
    );
    assert_eq!(fs::read(root.join("valid.tar")).unwrap(), b"preserved");
    execute(
        request(temp.path(), json!([])),
        &OperationContext::cleanup(),
    )
    .unwrap();
    fs::rename(&root, temp.path().join("pinned-old")).unwrap();
    symlink(&outside, &root).unwrap();
    assert!(
        execute(
            request(temp.path(), json!(["outside.tar"])),
            &OperationContext::cleanup()
        )
        .is_err()
    );
    assert_eq!(fs::read(outside.join("outside.tar")).unwrap(), b"outside");
}

#[cfg(unix)]
#[test]
fn concurrent_cancellation_never_reports_partial_deletion_as_success() {
    use std::{
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        thread,
        time::{Duration, Instant},
    };
    let temp = tempfile::tempdir().unwrap();
    let root = create_backup_directory(temp.path());
    let names: Vec<_> = (0..512).map(|index| format!("{index:04}.tar")).collect();
    for name in &names {
        fs::write(root.join(name), b"backup").unwrap();
    }
    let context = OperationContext::cleanup();
    let watcher_context = context.clone();
    let first = root.join(&names[0]);
    let finished = Arc::new(AtomicBool::new(false));
    let watcher_finished = Arc::clone(&finished);
    let watcher = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !watcher_finished.load(Ordering::Acquire) && Instant::now() < deadline {
            if !first.exists() {
                watcher_context.cancel();
                return true;
            }
            thread::yield_now();
        }
        false
    });
    let result = execute(request(temp.path(), json!(names)), &context);
    finished.store(true, Ordering::Release);
    watcher.join().unwrap();
    let remaining = fs::read_dir(root).unwrap().count();
    match result {
        Err(error) => {
            assert_eq!(error.code, "CORE_OPERATION_UNCERTAIN");
            assert!(remaining < 512);
        }
        // Cooperative cancellation may arrive after the final checked mutation.
        // A confirmed complete deletion remains authoritative in that schedule.
        Ok(value) => {
            assert_eq!(value, json!({"ok": true}));
            assert_eq!(remaining, 0);
        }
    }
}
