use base64::{Engine, engine::general_purpose::STANDARD};
use marketplace_core::{protocol::OperationContext, storage::execute};
use serde_json::{Value, json};
use std::fs;

fn branding(root: &std::path::Path) -> Value {
    json!({"operation":"brandingPublish","rootDirectory":root,"largeBase64":STANDARD.encode(b"RIFF\x04\0\0\0WEBP"),"smallBase64":STANDARD.encode(b"RIFF\x04\0\0\0WEBP"),"faviconBase64":STANDARD.encode([0,0,1,0,1,0,32,32,0,0,1,0,32,0,8,0,0,0,22,0,0,0,137,80,78,71,13,10,26,10])})
}

fn publish_backup(
    temp: &std::path::Path,
    source: &std::path::Path,
    destination: &std::path::Path,
) -> Value {
    json!({"operation":"backupPublishFile","backupDirectory":temp.join("backups"),"storageDirectory":temp.join("storage"),"sourcePath":source,"destinationPath":destination})
}

#[test]
fn backup_publication_syncs_and_replaces_from_a_nested_private_stage() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("backups");
    let stage = root.join(".import-stage");
    fs::create_dir_all(&stage).unwrap();
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
    fs::create_dir(&root).unwrap();
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
    fs::create_dir(&root).unwrap();
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
    fs::create_dir(&root).unwrap();
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
    execute(branding(&root), &OperationContext::cleanup()).expect("initial publication");
    execute(branding(&root), &OperationContext::cleanup()).expect("replacement publication");
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
fn branding_validates_entire_batch_before_io_and_rejects_cancelled_calls() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("public");
    for field in ["largeBase64", "smallBase64", "faviconBase64"] {
        for data in [
            "".to_owned(),
            "?".to_owned(),
            STANDARD.encode(b"not an image"),
            STANDARD.encode(vec![0; 8 * 1024 * 1024 + 1]),
        ] {
            let mut request = branding(&root);
            request[field] = json!(data);
            assert!(execute(request, &OperationContext::cleanup()).is_err());
            assert!(!root.exists());
        }
    }
    let context = OperationContext::cleanup();
    context.cancel();
    assert_eq!(
        execute(branding(&root), &context).unwrap_err().code,
        "CORE_CANCELLED"
    );
    assert!(!root.exists());
}

#[test]
fn branding_preflight_failure_cleans_private_staging_and_keeps_original() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("public");
    fs::create_dir_all(root.join("images/system/logo-64.webp")).unwrap();
    fs::write(root.join("images/system/logo.webp"), b"original").unwrap();
    assert!(execute(branding(&root), &OperationContext::cleanup()).is_err());
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
    let mut request = branding(&root);
    let mut large = vec![0; 8 * 1024 * 1024];
    large[..4].copy_from_slice(b"RIFF");
    let declared_size = ((large.len() - 8) as u32).to_le_bytes();
    large[4..8].copy_from_slice(&declared_size);
    large[8..12].copy_from_slice(b"WEBP");
    request["largeBase64"] = json!(STANDARD.encode(&large));
    request["smallBase64"] = json!(STANDARD.encode(&large));
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
    let result = execute(request, &context);
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
    assert!(execute(branding(&root), &OperationContext::cleanup()).is_err());
    assert_eq!(fs::read(outside).unwrap(), b"original");
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
}
