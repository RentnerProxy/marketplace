use marketplace_core::{
    protocol::OperationContext,
    storage::{execute, execute_worker},
};
use serde_json::{Value, json};
use std::fs;

fn favicon() -> [u8; 30] {
    [
        0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0, 8, 0, 0, 0, 22, 0, 0, 0, 137, 80, 78, 71, 13,
        10, 26, 10,
    ]
}
fn branding(
    root: &std::path::Path,
    image: &[u8],
    context: &OperationContext,
) -> Result<(), marketplace_core::protocol::CoreError> {
    let favicon = favicon();
    let bytes = [image, image, favicon.as_slice()].concat();
    let request = json!({"operation":"brandingPublish","rootDirectory":root,"binaryLengths":[image.len(),image.len(),favicon.len()]});
    execute_worker(&request, Some(&bytes), context).map(|_| ())
}
const WEBP: &[u8] = b"RIFF\x04\0\0\0WEBP";

fn publish_backup(
    temp: &std::path::Path,
    source: &std::path::Path,
    destination: &std::path::Path,
) -> Value {
    json!({"operation":"backupPublishFile","backupDirectory":temp.join("backups"),"storageDirectory":temp.join("storage"),"sourcePath":source,"destinationPath":destination})
}

fn create_private_directory(path: &std::path::Path) {
    #[allow(unused_mut)]
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).unwrap();
}

#[test]
fn backup_publication_syncs_and_replaces_from_a_nested_private_stage() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("backups");
    let stage = root.join(".import-stage");
    create_private_directory(&root);
    create_private_directory(&stage);
    let source = stage.join("archive.partial");
    let destination = root.join("archive.tar");
    fs::write(&destination, b"original").unwrap();
    for content in [b"replacement".as_slice(), b"replacement again".as_slice()] {
        fs::write(&source, content).unwrap();
        assert_eq!(
            execute(
                publish_backup(temp.path(), &source, &destination),
                &OperationContext::cleanup()
            )
            .unwrap(),
            json!({"ok":true})
        );
        assert!(!source.exists());
        assert_eq!(fs::read(&destination).unwrap(), content);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(destination).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn backup_publication_rejects_crossroot_aliases_and_failure_preserves_source() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("backups");
    create_private_directory(&root);
    let source = root.join("source.partial");
    fs::write(&source, b"original").unwrap();
    let outside = temp.path().join("outside");
    fs::write(&outside, b"outside").unwrap();
    let directory = root.join("directory");
    fs::create_dir(&directory).unwrap();
    for (from, to) in [
        (&source, &source),
        (&source, &outside),
        (&outside, &source),
        (&source, &directory),
        (&directory, &source),
    ] {
        assert_eq!(
            execute(
                publish_backup(temp.path(), from, to),
                &OperationContext::cleanup()
            )
            .unwrap_err()
            .code,
            "STORAGE_INVALID"
        );
        assert_eq!(fs::read(&source).unwrap(), b"original");
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
    }
    let context = OperationContext::cleanup();
    context.cancel();
    assert_eq!(
        execute(
            publish_backup(temp.path(), &source, &root.join("target.tar")),
            &context
        )
        .unwrap_err()
        .code,
        "CORE_CANCELLED"
    );
    assert_eq!(fs::read(&source).unwrap(), b"original");
}

#[test]
fn backup_publication_rejects_hardlinked_source() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("backups");
    create_private_directory(&root);
    let source = root.join("source.partial");
    fs::write(&source, b"original").unwrap();
    fs::hard_link(&source, root.join("alias")).unwrap();
    assert_eq!(
        execute(
            publish_backup(temp.path(), &source, &root.join("target.tar")),
            &OperationContext::cleanup()
        )
        .unwrap_err()
        .code,
        "STORAGE_INVALID"
    );
    assert_eq!(fs::read(&source).unwrap(), b"original");
    assert!(!root.join("target.tar").exists());
}

#[cfg(unix)]
#[test]
fn backup_publication_rejects_symlink_source_and_destination() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("backups");
    create_private_directory(&root);
    let source = root.join("source.partial");
    fs::write(&source, b"original").unwrap();
    let alias = root.join("alias");
    symlink(&source, &alias).unwrap();
    for (from, to) in [(&alias, &root.join("target.tar")), (&source, &alias)] {
        assert_eq!(
            execute(
                publish_backup(temp.path(), from, to),
                &OperationContext::cleanup()
            )
            .unwrap_err()
            .code,
            "STORAGE_INVALID"
        );
    }
    assert_eq!(fs::read(source).unwrap(), b"original");
}

#[test]
fn backup_batch_creates_private_root_and_rechecks_it_every_time() {
    let temp = tempfile::tempdir().unwrap();
    let backup = temp.path().join("backups");
    let storage = temp.path().join("storage");
    let request = json!({"operation":"backupPreparePaths","backupDirectory":backup,"storageDirectory":storage,"fileNames":["a.tar","b.tar"]});
    let result = execute(request.clone(), &OperationContext::cleanup()).unwrap();
    assert_eq!(
        result["paths"],
        json!([backup.join("a.tar"), backup.join("b.tar")])
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    fs::remove_dir(&backup).unwrap();
    fs::write(&backup, b"hostile replacement").unwrap();
    assert!(execute(request, &OperationContext::cleanup()).is_err());
}

#[cfg(unix)]
#[test]
fn backup_path_lookup_hardens_default_mode_and_preserves_private_root_metadata() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let temp = tempfile::tempdir().unwrap();
    let backup = temp.path().join("backups");
    let storage = temp.path().join("storage");
    let request = json!({"operation":"backupPreparePaths","backupDirectory":backup,"storageDirectory":storage,"fileNames":["a.tar"]});
    let context = OperationContext::cleanup();
    fs::create_dir(&backup).unwrap();
    fs::set_permissions(&backup, fs::Permissions::from_mode(0o755)).unwrap();
    execute(request.clone(), &context).unwrap();
    let before = fs::metadata(&backup).unwrap();
    assert_eq!(before.permissions().mode() & 0o7777, 0o700);
    execute(request.clone(), &context).unwrap();
    let after = fs::metadata(&backup).unwrap();
    assert_eq!(
        (before.ctime(), before.ctime_nsec()),
        (after.ctime(), after.ctime_nsec())
    );
    fs::set_permissions(&backup, fs::Permissions::from_mode(0o775)).unwrap();
    assert!(execute(request, &context).is_err());
    assert_eq!(
        fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
        0o775
    );
}

#[cfg(unix)]
#[test]
fn fence_admission_bootstraps_preexisting_local_development_directories() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let backup = temp.path().join("backups");
    let storage = temp.path().join("storage");
    let fence = backup.join(".storage-mutation-barrier-v1");
    let shared = fence.join("shared");
    fs::create_dir_all(&shared).unwrap();
    for directory in [&backup, &fence, &shared] {
        fs::set_permissions(directory, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let context = OperationContext::cleanup();

    let restore =
        json!({"operation":"restoreStateGet","backupDirectory":backup,"storageDirectory":storage});
    assert!(execute(restore, &context).unwrap().is_null());
    let prepare = json!({"operation":"backupPreparePaths","backupDirectory":backup,"storageDirectory":storage,"fileNames":[".storage-mutation-barrier-v1"]});
    assert_eq!(execute(prepare, &context).unwrap()["paths"], json!([fence]));
    let admission = json!({"operation":"fenceAdmitShared","rootDirectory":fence});
    let lease = execute(admission, &context).unwrap();
    assert_eq!(
        execute(json!({"operation":"fenceRelease","lease":lease}), &context).unwrap(),
        json!({"ok":true})
    );
    for directory in [&backup, &fence, &shared] {
        assert_eq!(
            fs::metadata(directory).unwrap().permissions().mode() & 0o7777,
            0o700
        );
    }
}

#[cfg(target_os = "linux")]
#[test]
fn backup_path_preparation_clears_inherited_setgid_only_on_new_directories() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o2700)).unwrap();
    let backup = temp.path().join("backups");
    let storage = temp.path().join("storage");
    fs::create_dir(&storage).unwrap();
    fs::set_permissions(&storage, fs::Permissions::from_mode(0o2755)).unwrap();
    let mode = |path: &std::path::Path| fs::metadata(path).unwrap().permissions().mode() & 0o7777;

    let request = json!({"operation":"backupPreparePaths","backupDirectory":backup,"storageDirectory":storage,"fileNames":["a.tar"]});
    execute(request, &OperationContext::cleanup()).unwrap();

    assert_eq!(mode(&backup), 0o700);
    assert_eq!(mode(&storage), 0o2755);
    assert_eq!(mode(temp.path()), 0o2700);
}

#[cfg(unix)]
#[test]
fn backup_publication_rejects_an_existing_group_writable_root_without_chmod() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("backups");
    create_private_directory(&root);
    fs::set_permissions(&root, fs::Permissions::from_mode(0o775)).unwrap();
    let source = root.join("source.partial");
    let destination = root.join("target.tar");
    fs::write(&source, b"replacement").unwrap();
    fs::write(&destination, b"original").unwrap();

    let error = execute(
        publish_backup(temp.path(), &source, &destination),
        &OperationContext::cleanup(),
    )
    .unwrap_err();

    assert_eq!(error.code, "STORAGE_INVALID");
    assert_eq!(
        fs::metadata(&root).unwrap().permissions().mode() & 0o7777,
        0o775
    );
    assert_eq!(fs::read(&destination).unwrap(), b"original");
    assert_eq!(fs::read(&source).unwrap(), b"replacement");
}

#[test]
fn backup_rejects_overlap_bad_names_and_unbounded_batches_without_creating_roots() {
    let temp = tempfile::tempdir().unwrap();
    let storage = temp.path().join("storage");
    for name in [
        ".",
        "..",
        "../escape",
        "a/b",
        "a\\b",
        "",
        "white space",
        "NUL:stream",
    ] {
        assert!(execute(json!({"operation":"backupPreparePaths","backupDirectory":temp.path().join("backup"),"storageDirectory":storage,"fileNames":[name]}),&OperationContext::cleanup()).is_err());
    }
    assert!(!storage.exists());
    for backup in [storage.clone(), storage.join("nested")] {
        let error=execute(json!({"operation":"backupPreparePaths","backupDirectory":backup,"storageDirectory":storage,"fileNames":["a.tar"]}),&OperationContext::cleanup()).unwrap_err();
        assert_eq!(error.code, "BACKUP_ROOT_OVERLAP");
    }
    assert!(execute(json!({"operation":"backupPreparePaths","backupDirectory":temp.path().join("backup"),"storageDirectory":storage,"fileNames":vec!["a";1025]}),&OperationContext::cleanup()).is_err());
}

#[test]
fn branding_publishes_and_replaces_all_files_with_no_staging_left() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("public");
    branding(&root, WEBP, &OperationContext::cleanup()).expect("initial publication");
    branding(&root, WEBP, &OperationContext::cleanup()).expect("replacement publication");
    assert_eq!(
        fs::read(root.join("images/system/logo.webp")).unwrap(),
        b"RIFF\x04\0\0\0WEBP"
    );
    assert_eq!(
        fs::read(root.join("images/system/logo-64.webp")).unwrap(),
        b"RIFF\x04\0\0\0WEBP"
    );
    assert_eq!(fs::read(root.join("favicon.ico")).unwrap().len(), 30);
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
}

#[test]
fn branding_preflight_failure_cleans_private_staging_and_keeps_original() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("public");
    fs::create_dir_all(root.join("images/system/logo-64.webp")).unwrap();
    fs::write(root.join("images/system/logo.webp"), b"original").unwrap();
    assert!(branding(&root, WEBP, &OperationContext::cleanup()).is_err());
    assert_eq!(
        fs::read(root.join("images/system/logo.webp")).unwrap(),
        b"original"
    );
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
}

#[test]
fn cancellation_during_staging_cleans_unpublished_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("public");
    fs::create_dir(&root).unwrap();
    let mut large = vec![0; 8 * 1024 * 1024];
    large[..4].copy_from_slice(b"RIFF");
    let declared_size = ((large.len() - 8) as u32).to_le_bytes();
    large[4..8].copy_from_slice(&declared_size);
    large[8..12].copy_from_slice(b"WEBP");
    let context = OperationContext::cleanup();
    let watcher_context = context.clone();
    let watcher_root = root.clone();
    let watcher = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if fs::read_dir(&watcher_root).unwrap().any(|entry| {
                entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".branding-")
            }) {
                watcher_context.cancel();
                return true;
            }
            std::thread::yield_now();
        }
        false
    });
    let result = branding(&root, &large, &context);
    assert!(watcher.join().unwrap(), "private staging must be observed");
    assert_eq!(result.unwrap_err().code, "CORE_CANCELLED");
    assert!(!root.join("images/system/logo.webp").exists());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn workflows_reject_symlink_roots_and_destinations() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let storage = temp.path().join("storage");
    fs::create_dir_all(storage.join("backups")).unwrap();
    let alias = temp.path().join("alias");
    symlink(storage.join("backups"), &alias).unwrap();
    assert_eq!(execute(json!({"operation":"backupPreparePaths","backupDirectory":alias,"storageDirectory":storage,"fileNames":["a"]}),&OperationContext::cleanup()).unwrap_err().code,"BACKUP_ROOT_OVERLAP");
    let root = temp.path().join("public");
    fs::create_dir_all(root.join("images/system")).unwrap();
    let outside = temp.path().join("outside");
    fs::write(&outside, b"original").unwrap();
    symlink(&outside, root.join("favicon.ico")).unwrap();
    assert!(branding(&root, WEBP, &OperationContext::cleanup()).is_err());
    assert_eq!(fs::read(outside).unwrap(), b"original");
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
}
