//! Private publication-barrier faults cannot be triggered through the public
//! protocol without racy filesystem timing or production fault switches.
use super::*;
use serde_json::json;

fn state() -> State {
    validate(json!({"version":1,"status":"running","phase":"validating","percent":25,"processedBytes":25,"totalBytes":100,"startedAt":"2026-08-11T10:00:00.000Z","updatedAt":"2026-08-11T10:00:01.000Z"})).unwrap()
}
fn roots(directory: &std::path::Path) -> workflows::BackupRoots {
    workflows::backup_roots(&json!({"backupDirectory":directory.join("backup"),"storageDirectory":directory.join("storage")}),&OperationContext::cleanup()).unwrap()
}

#[test]
fn restore_dates_keep_utc_format_and_calendar_validation() {
    for valid in ["2024-02-29T23:59:59Z", "2026-08-11T10:00:00.000Z"] {
        assert!(valid_date(valid), "{valid}");
    }
    for invalid in [
        "2026-02-29T10:00:00Z",
        "2026-08-11T29:00:00Z",
        "2026-08-11T10:00:00+00:00",
        "2026-08-11T10:00:00Z\n",
        "2026-08-11 10:00:00Z",
    ] {
        assert!(!valid_date(invalid), "{invalid}");
    }
}

#[test]
fn directory_sync_failure_after_rename_is_uncertain_and_preserves_committed_state() {
    let directory = tempfile::tempdir().unwrap();
    let roots = roots(directory.path());
    let error = write_state(state(), &roots, &OperationContext::cleanup(), |_| {
        Err(std::io::Error::other("synthetic directory fsync failure").into())
    })
    .unwrap_err();
    assert_eq!(error.code, "CORE_OPERATION_UNCERTAIN");
    assert_eq!(roots.backup.entries().unwrap().count(), 1);
    let (_, bytes) = read_bytes(&roots, &OperationContext::cleanup())
        .unwrap()
        .unwrap();
    assert_eq!(bytes, serde_json::to_vec(&state()).unwrap());
    assert!(!error.message.contains("synthetic"));
}

#[test]
fn same_inode_content_tampering_and_late_cancellation_after_rename_are_uncertain() {
    for attack in ["content", "cancel"] {
        let directory = tempfile::tempdir().unwrap();
        let roots = roots(directory.path());
        let context = OperationContext::cleanup();
        let error = write_state(state(), &roots, &context, |_| {
            if attack == "content" {
                let mut changed = serde_json::to_value(state()).unwrap();
                changed["percent"] = json!(50);
                std::fs::write(
                    roots.backup_path.join(NAME),
                    serde_json::to_vec(&changed).unwrap(),
                )?;
            } else {
                context.cancel();
            }
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.code, "CORE_OPERATION_UNCERTAIN", "{attack}");
        assert!(roots.backup.symlink_metadata(NAME).unwrap().is_file());
        assert_eq!(roots.backup.entries().unwrap().count(), 1);
    }
}

#[cfg(unix)]
#[test]
fn destination_replacement_or_root_replacement_after_rename_is_uncertain() {
    for attack in ["inode", "backup-root", "storage-root"] {
        let directory = tempfile::tempdir().unwrap();
        let roots = roots(directory.path());
        let error = write_state(state(), &roots, &OperationContext::cleanup(), |_| {
            match attack {
                "inode" => {
                    std::fs::rename(
                        roots.backup_path.join(NAME),
                        roots.backup_path.join("original"),
                    )?;
                    let mut replacement = files::create_file(&roots.backup, Path::new(NAME))?;
                    replacement.write_all(&serde_json::to_vec(&state())?)?;
                    replacement.sync_all()?;
                }
                "backup-root" => {
                    std::fs::rename(&roots.backup_path, directory.path().join("original-backup"))?;
                    std::fs::create_dir(&roots.backup_path)?;
                }
                _ => {
                    let storage_path = directory.path().join("storage");
                    std::fs::rename(&storage_path, directory.path().join("original-storage"))?;
                    std::fs::create_dir(storage_path)?;
                }
            }
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.code, "CORE_OPERATION_UNCERTAIN", "{attack}");
        assert!(roots.backup.symlink_metadata(NAME).unwrap().is_file());
    }
}

#[test]
fn a_storage_root_appearing_during_a_read_invalidates_the_observation() {
    let directory = tempfile::tempdir().unwrap();
    let context = OperationContext::cleanup();
    let existing = roots(directory.path());
    write_state(state(), &existing, &context, files::sync_dir).unwrap();
    drop(existing);
    let storage = directory.path().join("storage");
    std::fs::remove_dir(&storage).unwrap();
    let request =
        json!({"backupDirectory":directory.path().join("backup"),"storageDirectory":storage});
    let observed = workflows::read_backup_roots(&request, &context)
        .unwrap()
        .unwrap();
    std::fs::create_dir(storage).unwrap();
    assert!(read_bytes(&observed, &context).is_err());
}
