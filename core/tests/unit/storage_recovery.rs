use super::*;

fn fixture() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[test]
fn bounded_copy_rejects_entry_and_byte_overflow_before_creation() {
    let fixture = fixture();
    std::fs::create_dir(fixture.path().join("source")).unwrap();
    std::fs::create_dir(fixture.path().join("target")).unwrap();
    std::fs::write(fixture.path().join("source/file"), b"bounded").unwrap();
    let source = open_absolute(&fixture.path().join("source"), false).unwrap();
    let target = open_absolute(&fixture.path().join("target"), false).unwrap();
    let context = OperationContext::default();
    let mut full_entries = MAX_ENTRIES;
    assert!(
        copy(
            &source,
            Path::new("file"),
            &target,
            Path::new("new"),
            &context,
            &mut CopyState {
                entries: MAX_ENTRIES,
                ..CopyState::default()
            }
        )
        .is_err()
    );
    assert!(
        copy(
            &source,
            Path::new("file"),
            &target,
            Path::new("new"),
            &context,
            &mut CopyState {
                bytes: MAX_BYTES,
                ..CopyState::default()
            }
        )
        .is_err()
    );
    assert!(measure(&source, &mut full_entries, &context).is_err());
    assert!(!target.exists("new"));
}

#[test]
fn unpublished_original_intent_is_safe_to_roll_back_repeatedly() {
    let fixture = fixture();
    let root_path = fixture.path().join("root");
    let recovery_path = fixture.path().join("recovery");
    std::fs::create_dir(&root_path).unwrap();
    std::fs::create_dir(&recovery_path).unwrap();
    std::fs::write(root_path.join("old"), b"old").unwrap();
    let root = open_absolute(&root_path, false).unwrap();
    let recovery = open_absolute(&recovery_path, false).unwrap();
    let original_identity = identity(&root.symlink_metadata("old").unwrap()).unwrap();
    let journal = Journal {
        token: uuid::Uuid::new_v4().to_string(),
        storage_root: root_path.clone(),
        root_identity: identity(&root.dir_metadata().unwrap()).unwrap(),
        recovery_identity: identity(&recovery.dir_metadata().unwrap()).unwrap(),
        installed: vec![],
        moved: vec![OwnedEntry {
            name: "old".into(),
            identity: original_identity.clone(),
            parent_identity: identity(&recovery.dir_metadata().unwrap()).unwrap(),
            original_parent_identity: Some(identity(&root.dir_metadata().unwrap()).unwrap()),
            original_identity: Some(original_identity),
        }],
        persisted_moved: 0,
        persisted_installed: 0,
        journal_bytes: 0,
        journal_identity: None,
    };
    rollback(&root, &recovery, &journal).unwrap();
    rollback(&root, &recovery, &journal).unwrap();
    assert_eq!(std::fs::read(root_path.join("old")).unwrap(), b"old");
}

#[test]
fn copied_original_recovery_replaces_only_the_owned_partial_original() {
    let fixture = fixture();
    let root_path = fixture.path().join("root");
    let recovery_path = fixture.path().join("recovery");
    std::fs::create_dir(&root_path).unwrap();
    std::fs::create_dir(&recovery_path).unwrap();
    std::fs::write(root_path.join("old"), b"partial original").unwrap();
    std::fs::write(recovery_path.join("old"), b"complete original").unwrap();
    let root = open_absolute(&root_path, false).unwrap();
    let recovery = open_absolute(&recovery_path, false).unwrap();
    let root_identity = identity(&root.dir_metadata().unwrap()).unwrap();
    let recovery_identity = identity(&recovery.dir_metadata().unwrap()).unwrap();
    let journal = Journal {
        token: uuid::Uuid::new_v4().to_string(),
        storage_root: root_path.clone(),
        root_identity: root_identity.clone(),
        recovery_identity: recovery_identity.clone(),
        installed: vec![],
        moved: vec![OwnedEntry {
            name: "old".into(),
            identity: identity(&recovery.symlink_metadata("old").unwrap()).unwrap(),
            parent_identity: recovery_identity,
            original_parent_identity: Some(root_identity),
            original_identity: Some(identity(&root.symlink_metadata("old").unwrap()).unwrap()),
        }],
        persisted_moved: 0,
        persisted_installed: 0,
        journal_bytes: 0,
        journal_identity: None,
    };
    rollback(&root, &recovery, &journal).unwrap();
    assert_eq!(
        std::fs::read(root_path.join("old")).unwrap(),
        b"complete original"
    );
    assert!(!recovery.exists("old"));
    assert!(entry_parent(&root, "../outside", false).is_err());
    assert!(entry_parent(&root, "", false).is_err());
}

#[cfg(unix)]
#[test]
fn invalid_utf8_root_names_are_rejected_without_lossy_path_resolution() {
    use std::os::unix::ffi::OsStringExt;
    let fixture = fixture();
    std::fs::write(
        fixture
            .path()
            .join(std::ffi::OsString::from_vec(vec![0xff])),
        b"owned",
    )
    .unwrap();
    assert!(names(&open_absolute(fixture.path(), false).unwrap()).is_err());
}

#[test]
fn journal_appends_replays_updates_and_rejects_torn_or_replaced_records() {
    let fixture = fixture();
    let dir = open_absolute(fixture.path(), false).unwrap();
    let id = identity(&dir.dir_metadata().unwrap()).unwrap();
    let mut journal = Journal {
        token: uuid::Uuid::new_v4().to_string(),
        storage_root: fixture.path().to_owned(),
        root_identity: id.clone(),
        recovery_identity: id.clone(),
        moved: vec![],
        installed: vec![],
        persisted_moved: 0,
        persisted_installed: 0,
        journal_bytes: 0,
        journal_identity: None,
    };
    persist(&dir, &mut journal).unwrap();
    let path = fixture
        .path()
        .join(format!(".native-state-{}.json", journal.token));
    let header = std::fs::read(&path).unwrap();
    for index in 0..8 {
        journal.moved.push(OwnedEntry {
            name: format!("original-{index}"),
            identity: id.clone(),
            parent_identity: id.clone(),
            original_parent_identity: Some(id.clone()),
            original_identity: Some(id.clone()),
        });
        persist(&dir, &mut journal).unwrap();
    }
    journal.moved.last_mut().unwrap().identity = json!({"dev":"1","ino":"2"});
    journal.persisted_moved -= 1;
    persist(&dir, &mut journal).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    assert!(bytes.starts_with(&header));
    let replayed = replay(&bytes).unwrap();
    assert_eq!(replayed.moved.len(), 8);
    assert_eq!(replayed.moved[7].identity, json!({"dev":"1","ino":"2"}));
    assert!(bytes.len() < header.len() + 4096);
    assert!(replay(&bytes[..bytes.len() - 1]).is_err());
    for (kind, index) in [("unknown", 8), ("moved", 99), ("installed", 99)] {
        let mut invalid = bytes.clone();
        serde_json::to_writer(
            &mut invalid,
            &json!({"kind":kind,"index":index,"entry":journal.moved[0]}),
        )
        .unwrap();
        invalid.push(b'\n');
        assert!(replay(&invalid).is_err());
    }
    std::fs::rename(&path, fixture.path().join("original-journal")).unwrap();
    std::fs::write(&path, &bytes).unwrap();
    assert!(persist(&dir, &mut journal).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
}

#[cfg(target_os = "linux")]
#[test]
fn cross_device_move_copies_syncs_then_removes_source_and_never_overwrites() {
    let fixture = fixture();
    let destination = tempfile::tempdir_in("/dev/shm").unwrap();
    std::fs::create_dir(fixture.path().join("nested")).unwrap();
    std::fs::write(fixture.path().join("nested/file"), b"cross-device").unwrap();
    let source = open_absolute(fixture.path(), false).unwrap();
    let target = open_absolute(destination.path(), false).unwrap();
    let context = OperationContext::default();
    assert_ne!(
        source.dir_metadata().unwrap().dev(),
        target.dir_metadata().unwrap().dev()
    );
    move_entry(
        &source,
        Path::new("nested"),
        &target,
        Path::new("copied"),
        &context,
        &mut CopyState::default(),
    )
    .unwrap();
    assert!(!source.exists("nested"));
    assert_eq!(
        std::fs::read(destination.path().join("copied/file")).unwrap(),
        b"cross-device"
    );
    std::fs::write(fixture.path().join("another"), b"another").unwrap();
    let error = move_entry(
        &source,
        Path::new("another"),
        &target,
        Path::new("copied"),
        &context,
        &mut CopyState::default(),
    )
    .unwrap_err();
    assert_eq!(error.code, "EEXIST");
    assert_eq!(
        std::fs::read(fixture.path().join("another")).unwrap(),
        b"another"
    );
    assert_eq!(
        rename_retry(
            &source,
            Path::new("missing"),
            &source,
            Path::new("missing"),
            &context
        )
        .unwrap_err()
        .code,
        "ENOENT"
    );
}
