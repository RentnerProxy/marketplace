use marketplace_core::{protocol::OperationContext, storage::execute};
use serde_json::{Value, json};
use std::fs;

fn state() -> Value {
    json!({"version":1,"status":"running","phase":"validating","percent":25,"processedBytes":25,"totalBytes":100,"startedAt":"2026-08-11T10:00:00.000Z","updatedAt":"2026-08-11T10:00:01.000Z"})
}
fn request(root: &std::path::Path, operation: &str, state: Value) -> Value {
    json!({"operation":operation,"backupDirectory":root.join("backup"),"storageDirectory":root.join("storage"),"state":state})
}
fn run(
    root: &std::path::Path,
    operation: &str,
    state: Value,
) -> Result<Value, marketplace_core::protocol::CoreError> {
    execute(
        request(root, operation, state),
        &OperationContext::cleanup(),
    )
}

#[test]
fn atomically_publishes_bounded_state_with_no_temporary_residue() {
    let root = tempfile::tempdir().unwrap();
    assert!(
        run(root.path(), "restoreStateGet", Value::Null)
            .unwrap()
            .is_null()
    );
    for status in ["running", "completed", "failed", "recovery-required"] {
        for phase in [
            "preparing",
            "validating",
            "creating-recovery",
            "replacing-storage",
            "restoring-database",
            "finalizing",
            "rolling-back",
        ] {
            let mut value = state();
            value["status"] = json!(status);
            value["phase"] = json!(phase);
            value["percent"] = Value::Null;
            assert_eq!(
                run(root.path(), "restoreStateWrite", value.clone()).unwrap(),
                value
            );
            assert_eq!(
                run(root.path(), "restoreStateGet", Value::Null).unwrap(),
                value
            );
            assert_eq!(fs::read_dir(root.path().join("backup")).unwrap().count(), 1);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(root.path().join("backup/.restore-state-v1.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn rejects_unsupported_unknown_missing_and_invalid_progress_before_publication() {
    let root = tempfile::tempdir().unwrap();
    for (field, value) in [
        ("version", json!(2)),
        ("status", json!("unknown")),
        ("phase", json!("unknown")),
        ("percent", json!(101)),
        ("percent", json!(-1)),
        ("percent", json!(1.5)),
        ("processedBytes", json!(-1)),
        ("processedBytes", json!(101)),
        ("totalBytes", json!(0)),
        ("totalBytes", json!(9_007_199_254_740_992_u64)),
        ("startedAt", json!("2026-02-30T10:00:00.000Z")),
        ("updatedAt", json!("2026-08-11T10:00:00+01:00")),
        ("extra", json!(true)),
    ] {
        let mut invalid = state();
        invalid[field] = value;
        assert!(
            run(root.path(), "restoreStateWrite", invalid).is_err(),
            "{field}"
        );
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
    for field in [
        "version",
        "status",
        "phase",
        "percent",
        "processedBytes",
        "totalBytes",
        "startedAt",
        "updatedAt",
    ] {
        let mut invalid = state();
        invalid.as_object_mut().unwrap().remove(field);
        assert!(
            run(root.path(), "restoreStateWrite", invalid).is_err(),
            "{field}"
        );
    }
}

#[test]
fn zero_and_maximum_safe_progress_and_fractional_iso_precision_round_trip() {
    let root = tempfile::tempdir().unwrap();
    for total in [0, 9_007_199_254_740_991_u64] {
        let mut value = state();
        value["processedBytes"] = json!(total);
        value["totalBytes"] = json!(total);
        value["percent"] = json!(100);
        value["startedAt"] = json!("2026-08-11T10:00:00Z");
        value["updatedAt"] = json!("2026-08-11T10:00:00.123456Z");
        assert_eq!(
            run(root.path(), "restoreStateWrite", value.clone()).unwrap(),
            value
        );
    }
}

#[test]
fn malformed_oversized_and_unknown_persisted_markers_fail_closed() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("backup")).unwrap();
    let path = root.path().join("backup/.restore-state-v1.json");
    for bytes in [
        b"{".to_vec(),
        vec![b' '; 65537],
        b"{\"version\":99,\"status\":\"running\"}".to_vec(),
        vec![255],
    ] {
        fs::write(&path, bytes).unwrap();
        assert!(run(root.path(), "restoreStateGet", Value::Null).is_err());
    }
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(run(root.path(), "restoreStateGet", Value::Null).is_err());
}

#[test]
fn failed_publication_cleans_only_owned_staging_file() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("backup/.restore-state-v1.json")).unwrap();
    assert!(run(root.path(), "restoreStateWrite", state()).is_err());
    assert_eq!(fs::read_dir(root.path().join("backup")).unwrap().count(), 1);
}

#[test]
fn cancelled_and_overlapping_requests_leave_no_state() {
    let root = tempfile::tempdir().unwrap();
    let context = OperationContext::cleanup();
    context.cancel();
    assert!(execute(request(root.path(), "restoreStateWrite", state()), &context).is_err());
    assert!(execute(json!({"operation":"restoreStateWrite","backupDirectory":root.path().join("storage/backup"),"storageDirectory":root.path().join("storage"),"state":state()}),&OperationContext::cleanup()).is_err());
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn nofollow_read_rejects_symlinks_and_write_replaces_link_without_following() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("backup")).unwrap();
    let external = root.path().join("external");
    fs::write(&external, b"outside").unwrap();
    let path = root.path().join("backup/.restore-state-v1.json");
    symlink(&external, &path).unwrap();
    assert!(run(root.path(), "restoreStateGet", Value::Null).is_err());
    run(root.path(), "restoreStateWrite", state()).unwrap();
    assert_eq!(fs::read(&external).unwrap(), b"outside");
    assert!(!fs::symlink_metadata(path).unwrap().is_symlink());
}

#[test]
fn hardlinked_state_is_rejected_without_changing_either_link() {
    let root = tempfile::tempdir().unwrap();
    run(root.path(), "restoreStateWrite", state()).unwrap();
    let path = root.path().join("backup/.restore-state-v1.json");
    let bytes = fs::read(&path).unwrap();
    let alias = root.path().join("state-alias");
    fs::hard_link(&path, &alias).unwrap();
    assert!(run(root.path(), "restoreStateGet", Value::Null).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(fs::read(alias).unwrap(), bytes);
}

#[cfg(unix)]
#[test]
fn nonprivate_state_is_rejected_without_repairing_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    run(root.path(), "restoreStateWrite", state()).unwrap();
    let path = root.path().join("backup/.restore-state-v1.json");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(run(root.path(), "restoreStateGet", Value::Null).is_err());
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o644
    );
}

#[cfg(unix)]
#[test]
fn fifo_state_is_rejected_promptly_without_a_writer() {
    use std::{
        io::Write,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("backup")).unwrap();
    let path = root.path().join("backup/.restore-state-v1.json");
    assert!(
        Command::new("mkfifo")
            .args(["-m", "600"])
            .arg(path)
            .status()
            .unwrap()
            .success()
    );
    let mut child = Command::new(env!("CARGO_BIN_EXE_marketplace-storage"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(
            &serde_json::to_vec(&request(root.path(), "restoreStateGet", Value::Null)).unwrap(),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(!status.success());
            let output = child.wait_with_output().unwrap();
            let response: Value = serde_json::from_slice(&output.stdout).unwrap();
            assert_eq!(response["type"], "error");
            break;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            let _ = child.wait();
            panic!("FIFO state read blocked past its deadline");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
