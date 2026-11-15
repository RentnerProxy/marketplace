use base64::{Engine, engine::general_purpose::STANDARD};
use cap_fs_ext::MetadataExt;
use marketplace_core::{protocol::OperationContext, storage::execute};
use serde_json::{Value, json};
use std::fs;

fn run(request: Value) -> Value {
    execute(request, &OperationContext::default()).expect("synthetic operation must succeed")
}
fn fixture() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}
fn create_root(base: &std::path::Path, name: &str) -> std::path::PathBuf {
    let path = base.join(name);
    fs::create_dir(&path).unwrap();
    path
}

#[test]
fn private_publication_is_bounded_confined_and_replaces_atomically() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "private");
    let file = root.join("images/user/background.webp");
    for payload in [
        b"original".as_slice(),
        b"replacement".as_slice(),
        b"".as_slice(),
    ] {
        run(
            json!({"operation":"writeFile","rootDirectory":root,"filePath":file,"dataBase64":STANDARD.encode(payload)}),
        );
        let read = run(json!({"operation":"readFile","rootDirectory":root,"filePath":file}));
        assert_eq!(
            STANDARD
                .decode(read["dataBase64"].as_str().unwrap())
                .unwrap(),
            payload
        );
    }
    assert!(execute(json!({"operation":"writeFile","rootDirectory":root,"filePath":fixture.path().join("outside"),"dataBase64":"AA=="}),&OperationContext::default()).is_err());
    assert!(!fixture.path().join("outside").exists());
    assert_eq!(fs::read_dir(file.parent().unwrap()).unwrap().count(), 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o7777,
            0o600
        );
        assert_eq!(
            fs::metadata(file.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o7777,
            0o700
        );
    }
}

#[test]
fn directory_snapshot_detects_replacement() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "private");
    let nested = root.join("images");
    let snapshots =
        run(json!({"operation":"prepareDirectories","rootDirectory":root,"directoryPath":nested}));
    fs::rename(&nested, root.join("original-images")).unwrap();
    fs::create_dir(&nested).unwrap();
    assert!(
        execute(
            json!({"operation":"assertDirectories","directories":snapshots}),
            &OperationContext::default()
        )
        .is_err()
    );
}

#[test]
fn physical_recovery_rolls_back_and_commits() {
    for action in ["rollback", "commit"] {
        let fixture = fixture();
        let root = create_root(fixture.path(), "storage");
        let restored = create_root(fixture.path(), "restored");
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("nested/original"), b"original").unwrap();
        fs::write(restored.join("new"), b"new").unwrap();
        let recovery = run(
            json!({"operation":"recoveryPrepare","storageRoot":root,"restoredStoragePath":restored}),
        );
        assert!(root.join("new").is_file());
        assert!(!root.join("nested").exists());
        run(
            json!({"operation":"recoveryFinish","recoveryDirectory":recovery["recoveryDirectory"],"token":recovery["token"],"proof":recovery["proof"],"action":action}),
        );
        assert!(!std::path::Path::new(recovery["recoveryDirectory"].as_str().unwrap()).exists());
        if action == "rollback" {
            assert_eq!(fs::read(root.join("nested/original")).unwrap(), b"original");
            assert!(!root.join("new").exists());
        } else {
            assert_eq!(fs::read(root.join("new")).unwrap(), b"new");
            assert!(!root.join("nested").exists());
        }
        assert_eq!(fs::read(restored.join("new")).unwrap(), b"new");
    }
}

#[test]
fn rollback_rejects_replaced_published_entry_and_preserves_recovery() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "storage");
    let restored = create_root(fixture.path(), "restored");
    fs::write(root.join("old"), b"original").unwrap();
    fs::write(restored.join("new"), b"new").unwrap();
    let recovery = run(
        json!({"operation":"recoveryPrepare","storageRoot":root,"restoredStoragePath":restored}),
    );
    fs::rename(root.join("new"), root.join("moved-installed")).unwrap();
    fs::write(root.join("new"), b"concurrent replacement").unwrap();
    assert!(execute(json!({"operation":"recoveryFinish","recoveryDirectory":recovery["recoveryDirectory"],"token":recovery["token"],"proof":recovery["proof"],"action":"rollback"}),&OperationContext::default()).is_err());
    assert_eq!(
        fs::read(root.join("new")).unwrap(),
        b"concurrent replacement"
    );
    assert_eq!(
        fs::read(std::path::Path::new(recovery["recoveryDirectory"].as_str().unwrap()).join("old"))
            .unwrap(),
        b"original"
    );
}

#[test]
fn cancelled_operation_cannot_publish() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "private");
    let context = OperationContext::default();
    context.cancel();
    assert!(execute(json!({"operation":"writeFile","rootDirectory":root,"filePath":root.join("new"),"dataBase64":"AA=="}),&context).is_err());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
}

fn file_identity(root: &std::path::Path, relative: &str) -> Value {
    let dir = cap_std::fs::Dir::open_ambient_dir(root, cap_std::ambient_authority()).unwrap();
    let metadata = dir.symlink_metadata(relative).unwrap();
    json!({"dev":metadata.dev().to_string(),"ino":metadata.ino().to_string()})
}

#[test]
fn complete_private_background_recovery_restores_snapshot_and_rolls_back() {
    for action in ["commit", "rollback"] {
        let fixture = fixture();
        let root = create_root(fixture.path(), "private");
        let restored = create_root(fixture.path(), "restored");
        for name in ["existing", "deleted"] {
            fs::create_dir(root.join(name)).unwrap();
            fs::write(root.join(name).join("background.webp"), name.as_bytes()).unwrap();
        }
        for name in ["existing", "new"] {
            fs::create_dir(restored.join(name)).unwrap();
            fs::write(restored.join(name).join("background.webp"), b"restored").unwrap();
        }
        let originals = ["existing/background.webp", "deleted/background.webp"]
            .map(|name| json!({"privateRelativePath":name,"identity":file_identity(&root,name)}));
        let recovery = run(
            json!({"operation":"recoveryPrepare","private":true,"completeSnapshot":true,"storageRoot":root,"restoredStoragePath":restored,"originalEntries":originals,"restoredRelativeFilePaths":["existing/background.webp","new/background.webp"]}),
        );
        assert_eq!(
            fs::read(root.join("existing/background.webp")).unwrap(),
            b"restored"
        );
        assert!(!root.join("deleted/background.webp").exists());
        run(
            json!({"operation":"recoveryFinish","recoveryDirectory":recovery["recoveryDirectory"],"token":recovery["token"],"proof":recovery["proof"],"action":action}),
        );
        if action == "rollback" {
            assert_eq!(
                fs::read(root.join("existing/background.webp")).unwrap(),
                b"existing"
            );
            assert_eq!(
                fs::read(root.join("deleted/background.webp")).unwrap(),
                b"deleted"
            );
            assert!(!root.join("new/background.webp").exists());
        }
    }
}

#[test]
fn legacy_private_background_recovery_preserves_existing_files() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "private");
    let restored = create_root(fixture.path(), "restored");
    fs::write(root.join("existing"), b"current").unwrap();
    fs::write(restored.join("existing"), b"legacy").unwrap();
    fs::write(restored.join("new"), b"new").unwrap();
    let recovery = run(
        json!({"operation":"recoveryPrepare","private":true,"completeSnapshot":false,"storageRoot":root,"restoredStoragePath":restored,"originalEntries":[],"restoredRelativeFilePaths":["existing","new"]}),
    );
    assert_eq!(fs::read(root.join("existing")).unwrap(), b"current");
    assert_eq!(fs::read(root.join("new")).unwrap(), b"new");
    run(
        json!({"operation":"recoveryFinish","recoveryDirectory":recovery["recoveryDirectory"],"token":recovery["token"],"proof":recovery["proof"],"action":"rollback"}),
    );
    assert_eq!(fs::read(root.join("existing")).unwrap(), b"current");
    assert!(!root.join("new").exists());
}

#[test]
fn utility_operations_are_private_durable_and_scoped() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "root");
    run(json!({"operation":"permissions","path":root}));
    let directory = run(json!({"operation":"tempDirectory","path":root,"prefix":"synthetic-"}));
    let directory = std::path::Path::new(directory.as_str().unwrap());
    fs::create_dir(directory.join("child")).unwrap();
    fs::write(directory.join("child/file"), b"file").unwrap();
    run(json!({"operation":"syncFile","path":directory.join("child/file")}));
    run(json!({"operation":"syncDirectory","path":directory}));
    run(json!({"operation":"syncTree","path":directory}));
    let target = root.join("renamed");
    run(json!({"operation":"rename","path":directory,"destination":target}));
    run(
        json!({"operation":"capacity","requests":[{"directoryPath":root,"sourcePaths":[target.clone(),target.join("child/file")],"additionalBytes":"0"}]}),
    );
    run(json!({"operation":"remove","path":target.join("child/file")}));
    run(json!({"operation":"remove","path":target}));
    run(json!({"operation":"remove","path":root.join("missing")}));
    assert_eq!(fs::read_dir(root).unwrap().count(), 0);
}

#[test]
fn storage_rejects_invalid_inputs_and_missing_backgrounds_without_side_effects() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "private");
    let public = create_root(fixture.path(), "public");
    assert!(
        run(json!({"operation":"readFile","rootDirectory":root,"filePath":root.join("missing") }))
            .is_null()
    );
    assert!(run(json!({"operation":"readBackground","rootDirectory":root,"directoryPath":root.join("user"),"filePath":root.join("user/background"),"legacyRoot":public,"legacyPath":public.join("missing/background") })).is_null());
    let requests = [
        json!({"operation":"unknown"}),
        json!({"operation":"writeFile","rootDirectory":root,"filePath":root.join("bad"),"dataBase64":"%%%"}),
        json!({"operation":"prepareDirectories","rootDirectory":" ","directoryPath":root}),
        json!({"operation":"prepareDirectories","rootDirectory":root,"directoryPath":fixture.path()}),
        json!({"operation":"tempDirectory","path":root,"prefix":"../escape"}),
        json!({"operation":"capacity","requests":[{"directoryPath":root,"sourcePaths":[],"additionalBytes":"18446744073709551615"}]}),
        json!({"operation":"capacity","requests":[{"directoryPath":root,"sourcePaths":[],"additionalBytes":"not-a-size"}]}),
        json!({"operation":"recoveryPrepare","storageRoot":root,"restoredStoragePath":root.join("inside")}),
        json!({"operation":"recoveryFinish","recoveryDirectory":root,"token":"not-a-token","action":"commit"}),
    ];
    for request in requests {
        assert!(execute(request, &OperationContext::default()).is_err());
    }
    let data = STANDARD.encode(vec![0; 8 * 1024 * 1024 + 1]);
    assert!(execute(json!({"operation":"writeFile","rootDirectory":root,"filePath":root.join("large"),"dataBase64":data}),&OperationContext::default()).is_err());
    assert!(!root.join("large").exists());
    let snapshots = run(
        json!({"operation":"prepareDirectories","rootDirectory":root,"directoryPath":root.join("nested")}),
    );
    run(json!({"operation":"assertDirectories","directories":snapshots}));
}

#[test]
fn failed_private_restore_rolls_back_moved_originals() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "private");
    let restored = create_root(fixture.path(), "restored");
    fs::write(root.join("old"), b"old").unwrap();
    let original = json!({"privateRelativePath":"old","identity":file_identity(&root,"old")});
    assert!(execute(json!({"operation":"recoveryPrepare","private":true,"completeSnapshot":true,"storageRoot":root,"restoredStoragePath":restored,"originalEntries":[original],"restoredRelativeFilePaths":["missing"]}),&OperationContext::default()).is_err());
    assert_eq!(fs::read(root.join("old")).unwrap(), b"old");
    assert_eq!(fs::read_dir(fixture.path()).unwrap().count(), 2);
}

#[test]
fn cancellation_after_storage_mutation_rolls_back_before_return() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "storage");
    let restored = create_root(fixture.path(), "restored");
    fs::write(root.join("old"), b"original").unwrap();
    // Enough entries to observe the durable original move before all installs
    // finish; cancellation is tied to that state transition rather than sleep.
    for index in 0..256 {
        fs::write(
            restored.join(format!("entry-{index}")),
            vec![7u8; 16 * 1024],
        )
        .unwrap();
    }
    let context = OperationContext::default();
    let cancellation = context.clone();
    let original = root.join("old");
    let cancel = std::thread::spawn(move || {
        for _ in 0..2000 {
            if !original.exists() {
                cancellation.cancel();
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        cancellation.cancel();
        false
    });
    let error = execute(
        json!({"operation":"recoveryPrepare","storageRoot":root,"restoredStoragePath":restored}),
        &context,
    )
    .unwrap_err();
    assert!(
        cancel.join().unwrap(),
        "the test must observe an actual storage mutation"
    );
    assert_eq!(error.code, "CORE_CANCELLED");
    assert_eq!(fs::read(root.join("old")).unwrap(), b"original");
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    assert_eq!(fs::read_dir(fixture.path()).unwrap().count(), 2);
}

#[test]
fn legacy_background_is_migrated_without_overwriting_current() {
    let fixture = fixture();
    let private = create_root(fixture.path(), "private");
    let public = create_root(fixture.path(), "public");
    let legacy = public.join("background.webp");
    let target = private.join("user/background.webp");
    fs::write(&legacy, b"legacy").unwrap();
    let request = json!({"operation":"readBackground","rootDirectory":private,"directoryPath":target.parent().unwrap(),"filePath":target,"legacyRoot":public,"legacyPath":legacy});
    assert_eq!(
        STANDARD
            .decode(run(request.clone())["dataBase64"].as_str().unwrap())
            .unwrap(),
        b"legacy"
    );
    assert!(!legacy.exists());
    fs::write(&legacy, b"new-legacy").unwrap();
    assert_eq!(
        STANDARD
            .decode(run(request)["dataBase64"].as_str().unwrap())
            .unwrap(),
        b"legacy"
    );
    assert_eq!(fs::read(legacy).unwrap(), b"new-legacy");
}

#[cfg(unix)]
#[test]
fn nofollow_rejects_symlinked_directory_and_file() {
    use std::os::unix::fs::symlink;
    let fixture = fixture();
    let root = create_root(fixture.path(), "private");
    let outside = create_root(fixture.path(), "outside");
    fs::write(outside.join("secret"), b"secret").unwrap();
    symlink(&outside, root.join("linked")).unwrap();
    symlink(outside.join("secret"), root.join("file")).unwrap();
    assert!(execute(json!({"operation":"writeFile","rootDirectory":root,"filePath":root.join("linked/new"),"dataBase64":"AA=="}),&OperationContext::default()).is_err());
    assert!(
        execute(
            json!({"operation":"readFile","rootDirectory":root,"filePath":root.join("file")}),
            &OperationContext::default()
        )
        .is_err()
    );
    assert!(!outside.join("new").exists());
    for request in [
        json!({"operation":"syncTree","path":root}),
        json!({"operation":"remove","path":root.join("file")}),
        json!({"operation":"capacity","requests":[{"directoryPath":root,"sourcePaths":[root.join("file")]}]}),
        json!({"operation":"readBackground","rootDirectory":root,"directoryPath":root,"filePath":root.join("file"),"legacyRoot":outside,"legacyPath":outside.join("secret")}),
    ] {
        assert!(execute(request, &OperationContext::default()).is_err());
    }
    assert_eq!(fs::read(outside.join("secret")).unwrap(), b"secret");
}

#[test]
fn failed_publication_cleans_only_its_owned_stage_and_keeps_existing_directory() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "private");
    let destination = create_root(&root, "destination");
    fs::write(destination.join("keep"), b"keep").unwrap();
    assert!(execute(json!({"operation":"writeFile","rootDirectory":root,"filePath":destination,"dataBase64":"AA=="}),&OperationContext::default()).is_err());
    assert_eq!(fs::read(destination.join("keep")).unwrap(), b"keep");
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    assert!(
        execute(
            json!({"operation":"readFile","rootDirectory":root,"filePath":destination}),
            &OperationContext::default()
        )
        .is_err()
    );
}

#[test]
fn oversized_background_reads_and_insufficient_recovery_capacity_are_rejected() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "private");
    let file = root.join("too-large");
    fs::write(&file, vec![0u8; 8 * 1024 * 1024 + 1]).unwrap();
    assert!(
        execute(
            json!({"operation":"readFile","rootDirectory":root,"filePath":file}),
            &OperationContext::default()
        )
        .is_err()
    );
    let error=execute(json!({"operation":"capacity","requests":[{"directoryPath":root,"sourcePaths":[],"additionalBytes":"1000000000000000000"}]}),&OperationContext::default()).unwrap_err();
    assert_eq!(error.code, "STORAGE_CAPACITY");
}

#[test]
fn recovery_tokens_and_changed_root_directory_are_rejected() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "storage");
    let restored = create_root(fixture.path(), "restored");
    fs::write(root.join("old"), b"old").unwrap();
    let recovery = run(
        json!({"operation":"recoveryPrepare","storageRoot":root,"restoredStoragePath":restored}),
    );
    for request in [
        json!({"operation":"recoveryFinish","recoveryDirectory":recovery["recoveryDirectory"],"token":uuid::Uuid::new_v4().to_string(),"action":"commit"}),
        json!({"operation":"recoveryFinish","recoveryDirectory":recovery["recoveryDirectory"],"token":recovery["token"],"proof":recovery["proof"],"action":"invalid"}),
    ] {
        assert!(execute(request, &OperationContext::default()).is_err());
    }
    fs::rename(&root, fixture.path().join("original-root")).unwrap();
    fs::create_dir(&root).unwrap();
    assert!(execute(json!({"operation":"recoveryFinish","recoveryDirectory":recovery["recoveryDirectory"],"token":recovery["token"],"proof":recovery["proof"],"action":"rollback"}),&OperationContext::default()).is_err());
    assert!(std::path::Path::new(recovery["recoveryDirectory"].as_str().unwrap()).exists());
}

#[test]
fn recovery_handle_rejects_replaced_journal_file() {
    let fixture = fixture();
    let root = create_root(fixture.path(), "storage");
    let restored = create_root(fixture.path(), "restored");
    fs::write(root.join("old"), b"old").unwrap();
    let recovery = run(
        json!({"operation":"recoveryPrepare","storageRoot":root,"restoredStoragePath":restored}),
    );
    let directory = std::path::Path::new(recovery["recoveryDirectory"].as_str().unwrap());
    let path = directory.join(format!(
        ".native-state-{}.json",
        recovery["token"].as_str().unwrap()
    ));
    let bytes = fs::read(&path).unwrap();
    fs::rename(&path, directory.join("original-journal")).unwrap();
    fs::write(&path, bytes).unwrap();
    assert!(execute(json!({"operation":"recoveryFinish","recoveryDirectory":recovery["recoveryDirectory"],"token":recovery["token"],"proof":recovery["proof"],"action":"commit"}),&OperationContext::default()).is_err());
    assert_eq!(fs::read(directory.join("old")).unwrap(), b"old");
}

#[test]
fn deep_valid_storage_trees_are_copied_synced_and_measured_without_recursion() {
    use cap_fs_ext::DirExt;
    let fixture = fixture();
    let root = create_root(fixture.path(), "storage");
    let restored = create_root(fixture.path(), "restored");
    fs::create_dir(restored.join("nested")).unwrap();
    let mut directory =
        cap_std::fs::Dir::open_ambient_dir(restored.join("nested"), cap_std::ambient_authority())
            .unwrap();
    for _ in 0..200 {
        directory.create_dir("d").unwrap();
        directory = directory.open_dir_nofollow("d").unwrap();
    }
    directory.write("leaf", b"deep-fixture").unwrap();
    drop(directory);
    run(json!({"operation":"syncTree","path":restored}));
    run(
        json!({"operation":"capacity","requests":[{"directoryPath":root,"sourcePaths":[restored],"additionalBytes":"0"}]}),
    );
    let recovery = run(
        json!({"operation":"recoveryPrepare","storageRoot":root,"restoredStoragePath":restored}),
    );
    let mut directory =
        cap_std::fs::Dir::open_ambient_dir(root.join("nested"), cap_std::ambient_authority())
            .unwrap();
    for _ in 0..200 {
        directory = directory.open_dir_nofollow("d").unwrap();
    }
    assert_eq!(directory.read("leaf").unwrap(), b"deep-fixture");
    drop(directory);
    run(
        json!({"operation":"recoveryFinish","recoveryDirectory":recovery["recoveryDirectory"],"token":recovery["token"],"proof":recovery["proof"],"action":"commit"}),
    );
}
