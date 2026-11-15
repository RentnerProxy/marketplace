use marketplace_core::{protocol::OperationContext, storage::execute};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

fn fixture() -> (tempfile::TempDir, PathBuf) {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("fence");
    (temporary, root)
}
fn create_private_directory(path: &Path) {
    #[allow(unused_mut)]
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).unwrap();
}
fn run(request: Value) -> Value {
    execute(request, &OperationContext::cleanup()).unwrap()
}
fn shared(root: &Path) -> Value {
    run(json!({"operation":"fenceAdmitShared","rootDirectory":root}))
}
fn exclusive(root: &Path, try_only: bool) -> Value {
    run(json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":try_only}))
}
fn release(lease: &Value) {
    run(json!({"operation":"fenceRelease","lease":lease}));
}
fn file(lease: &Value) -> &Path {
    Path::new(lease["file"]["path"].as_str().unwrap())
}
fn code(request: Value) -> String {
    execute(request, &OperationContext::cleanup())
        .unwrap_err()
        .code
}

#[test]
fn canonical_lease_reuse_and_release_preserve_wire_and_disk_contract() {
    let (_temporary, root) = fixture();
    let first = shared(&root);
    let second = shared(&root);
    let record = &first["file"]["metadata"];
    let expected = format!(
        "{{\"version\":1,\"kind\":\"shared\",\"owner\":\"{}\"}}",
        record["owner"].as_str().unwrap()
    );
    assert_eq!(fs::read(file(&first)).unwrap(), expected.as_bytes());
    assert!(expected.len() <= 256);
    assert_eq!(
        run(json!({"operation":"fenceAdmitShared","rootDirectory":root,"currentLease":first})),
        first
    );
    assert!(exclusive(&root, true).is_null());
    assert!(!root.join("exclusive.json").exists());
    release(&first);
    assert!(file(&second).exists());
    create_private_directory(&root.join("admission"));
    release(&second);
    assert!(root.join("admission").exists());
    fs::remove_dir(root.join("admission")).unwrap();
    let owner = exclusive(&root, true);
    run(json!({"operation":"fenceDrain","lease":owner}));
    release(&owner);
    assert_eq!(fs::read_dir(root).unwrap().count(), 1);
}

#[test]
fn exclusive_marker_prevents_new_and_reused_shared_admission_during_drain() {
    let (_temporary, root) = fixture();
    let work = shared(&root);
    let owner = exclusive(&root, false);
    for current in [Value::Null, work.clone()] {
        assert_eq!(
            code(
                json!({"operation":"fenceAdmitShared","rootDirectory":root,"currentLease":current})
            ),
            "STORAGE_MUTATION_ADMISSION_BUSY"
        );
    }
    assert!(exclusive(&root, true).is_null());
    assert_eq!(
        code(json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":false})),
        "STORAGE_MUTATION_ADMISSION_BUSY"
    );
    let context = OperationContext::cleanup();
    let cancelled = context.clone();
    let lease = owner.clone();
    let task = std::thread::spawn(move || {
        execute(json!({"operation":"fenceDrain","lease":lease}), &context)
    });
    std::thread::sleep(Duration::from_millis(70));
    cancelled.cancel();
    assert_eq!(task.join().unwrap().unwrap_err().code, "CORE_CANCELLED");
    release(&work);
    run(json!({"operation":"fenceDrain","lease":owner}));
    release(&owner);
}

#[test]
fn exclusive_drain_waits_for_shared_work_and_verifies_ownership_each_poll() {
    let (_temporary, root) = fixture();
    let work = shared(&root);
    let owner = exclusive(&root, false);
    let lease = owner.clone();
    let task = std::thread::spawn(move || run(json!({"operation":"fenceDrain","lease":lease})));
    std::thread::sleep(Duration::from_millis(75));
    assert!(!task.is_finished());
    release(&work);
    assert_eq!(task.join().unwrap(), json!({"ok":true}));
    release(&owner);
}

#[test]
fn gates_are_never_stolen_and_wait_is_bounded_or_cancellable() {
    let (_temporary, root) = fixture();
    release(&shared(&root));
    create_private_directory(&root.join("admission"));
    assert!(exclusive(&root, true).is_null());
    let start = Instant::now();
    assert_eq!(
        code(json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":false})),
        "STORAGE_MUTATION_ADMISSION_BUSY"
    );
    assert!(start.elapsed() >= Duration::from_millis(1000));
    assert!(start.elapsed() < Duration::from_secs(5));
    let context = OperationContext::cleanup();
    let cancel = context.clone();
    let owned_root = root.clone();
    let task = std::thread::spawn(move || {
        execute(
            json!({"operation":"fenceAcquireExclusive","rootDirectory":owned_root,"tryOnly":false}),
            &context,
        )
    });
    std::thread::sleep(Duration::from_millis(40));
    cancel.cancel();
    assert_eq!(task.join().unwrap().unwrap_err().code, "CORE_CANCELLED");
    assert_eq!(fs::read_dir(root.join("admission")).unwrap().count(), 0);
    fs::remove_dir(root.join("admission")).unwrap();
    release(&exclusive(&root, false));
}

#[test]
fn waiting_exclusive_can_acquire_after_legitimate_gate_release() {
    let (_temporary, root) = fixture();
    release(&shared(&root));
    let gate = root.join("admission");
    create_private_directory(&gate);
    let task = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        fs::remove_dir(gate).unwrap();
    });
    let owner = exclusive(&root, false);
    task.join().unwrap();
    release(&owner);
}

#[test]
fn copied_inode_hardlinks_changed_metadata_and_missing_files_are_never_released() {
    for mutation in [
        "copy",
        "hardlink",
        "metadata",
        "empty",
        "oversize",
        "missing",
        "directory",
    ] {
        let (temporary, root) = fixture();
        let lease = shared(&root);
        let target = file(&lease);
        let original = fs::read(target).unwrap();
        match mutation {
            "copy" => {
                fs::rename(target, temporary.path().join("original")).unwrap();
                fs::write(target, &original).unwrap();
            }
            "hardlink" => fs::hard_link(target, temporary.path().join("linked")).unwrap(),
            "metadata" => fs::write(target, b"{}").unwrap(),
            "empty" => fs::write(target, b"").unwrap(),
            "oversize" => fs::write(target, vec![b' '; 257]).unwrap(),
            "missing" => fs::remove_file(target).unwrap(),
            "directory" => {
                fs::remove_file(target).unwrap();
                fs::create_dir(target).unwrap();
            }
            _ => unreachable!(),
        }
        assert_eq!(
            code(json!({"operation":"fenceRelease","lease":lease})),
            "STORAGE_MUTATION_FENCE_UNAVAILABLE"
        );
        if mutation == "copy" || mutation == "hardlink" {
            assert_eq!(fs::read(target).unwrap(), original);
        }
    }
}

#[test]
fn malformed_foreign_control_files_and_entries_fail_closed() {
    for mutation in [
        "rootFile",
        "sharedFile",
        "ownerMismatch",
        "exclusiveDirectory",
        "gateFile",
        "invalidExclusive",
        "emptyExclusive",
    ] {
        let (_temporary, root) = fixture();
        release(&shared(&root));
        match mutation {
            "rootFile" => fs::write(root.join("foreign"), b"keep").unwrap(),
            "sharedFile" => fs::write(root.join("shared/foreign"), b"keep").unwrap(),
            "ownerMismatch" => {
                let first = shared(&root);
                let original = file(&first);
                fs::rename(
                    original,
                    root.join("shared/00000000-0000-4000-8000-000000000001.json"),
                )
                .unwrap();
            }
            "exclusiveDirectory" => fs::create_dir(root.join("exclusive.json")).unwrap(),
            "gateFile" => fs::write(root.join("admission"), b"keep").unwrap(),
            "invalidExclusive" => fs::write(root.join("exclusive.json"), b"{}").unwrap(),
            "emptyExclusive" => fs::write(root.join("exclusive.json"), b"").unwrap(),
            _ => unreachable!(),
        }
        assert_eq!(
            code(json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":true})),
            "STORAGE_MUTATION_FENCE_UNAVAILABLE"
        );
    }
}

#[test]
fn tampered_lease_scope_kind_identity_and_context_fail_before_unlink() {
    for mutation in [
        "root",
        "shared",
        "snapshots",
        "path",
        "identity",
        "kind",
        "owner",
        "version",
        "drainShared",
        "reuseExclusive",
        "currentRoot",
    ] {
        let (temporary, root) = fixture();
        let original = shared(&root);
        let mut lease = original.clone();
        match mutation {
            "root" => lease["context"]["rootDirectory"] = json!(temporary.path()),
            "shared" => lease["context"]["sharedDirectory"] = json!(temporary.path()),
            "snapshots" => lease["context"]["directories"] = json!([]),
            "path" => lease["file"]["path"] = json!(temporary.path().join("foreign")),
            "identity" => lease["file"]["identity"]["ino"] = json!("0"),
            "kind" => lease["file"]["metadata"]["kind"] = json!("admission"),
            "owner" => lease["file"]["metadata"]["owner"] = json!("invalid"),
            "version" => lease["file"]["metadata"]["version"] = json!(2),
            "reuseExclusive" => {
                release(&original);
                lease = exclusive(&root, false);
            }
            _ => (),
        }
        let request = match mutation {
            "drainShared" => json!({"operation":"fenceDrain","lease":lease}),
            "reuseExclusive" | "currentRoot" => {
                json!({"operation":"fenceAdmitShared","rootDirectory": if mutation == "currentRoot" {temporary.path()} else {&root},"currentLease":lease})
            }
            _ => json!({"operation":"fenceRelease","lease":lease}),
        };
        let error = code(request);
        assert!(
            error == "STORAGE_MUTATION_FENCE_UNAVAILABLE"
                || (mutation == "reuseExclusive" && error == "STORAGE_MUTATION_ADMISSION_BUSY")
        );
        if mutation != "reuseExclusive" {
            assert!(file(&original).exists());
        }
    }
}

#[test]
fn replaced_directories_and_cancelled_requests_have_no_mutation_authority() {
    for replace_root in [false, true] {
        let (temporary, root) = fixture();
        let lease = shared(&root);
        let target = if replace_root {
            root.clone()
        } else {
            root.join("shared")
        };
        fs::rename(&target, temporary.path().join("original")).unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(target.join("sentinel"), b"keep").unwrap();
        assert_eq!(
            code(json!({"operation":"fenceRelease","lease":lease})),
            "STORAGE_MUTATION_FENCE_UNAVAILABLE"
        );
        assert_eq!(fs::read(target.join("sentinel")).unwrap(), b"keep");
    }
    let (_temporary, root) = fixture();
    let context = OperationContext::cleanup();
    context.cancel();
    assert_eq!(
        execute(
            json!({"operation":"fenceAdmitShared","rootDirectory":root}),
            &context
        )
        .unwrap_err()
        .code,
        "CORE_CANCELLED"
    );
    assert!(!root.exists());
}

#[cfg(unix)]
#[test]
fn posix_modes_are_exact_and_existing_lease_modes_are_not_repaired() {
    use std::os::unix::fs::PermissionsExt;
    for directory in [false, true] {
        let (_temporary, root) = fixture();
        let lease = shared(&root);
        for target in [&root, &root.join("shared")] {
            assert_eq!(
                fs::metadata(target).unwrap().permissions().mode() & 0o7777,
                0o700
            );
        }
        assert_eq!(
            fs::metadata(file(&lease)).unwrap().permissions().mode() & 0o7777,
            0o600
        );
        let target = if directory {
            root.join("shared")
        } else {
            file(&lease).into()
        };
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            code(json!({"operation":"fenceRelease","lease":lease})),
            "STORAGE_MUTATION_FENCE_UNAVAILABLE"
        );
        assert_eq!(
            fs::metadata(target).unwrap().permissions().mode() & 0o7777,
            0o755
        );
    }
    let (_temporary, root) = fixture();
    release(&shared(&root));
    let gate = root.join("admission");
    create_private_directory(&gate);
    fs::set_permissions(&gate, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        code(json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":true})),
        "STORAGE_MUTATION_FENCE_UNAVAILABLE"
    );
    assert_eq!(
        fs::metadata(gate).unwrap().permissions().mode() & 0o7777,
        0o755
    );
}

#[test]
fn simultaneous_native_processes_publish_only_one_exclusive_owner_and_keep_crash_state() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let (_temporary, root) = fixture();
    let launch = |request: Value| {
        let mut command = Command::new(env!("CARGO_BIN_EXE_marketplace-storage"));
        command.env_clear();
        for key in ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        // These children complete normally and contribute their coverage even
        // though the test deliberately scrubs the application environment.
        if let Some(profile) = std::env::var_os("LLVM_PROFILE_FILE") {
            command.env("LLVM_PROFILE_FILE", profile);
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(request.to_string().as_bytes())
            .unwrap();
        child
    };
    let one =
        launch(json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":false}));
    let two =
        launch(json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":false}));
    let outputs = [
        one.wait_with_output().unwrap(),
        two.wait_with_output().unwrap(),
    ];
    assert_eq!(
        outputs
            .iter()
            .filter(|output| output.status.success())
            .count(),
        1
    );
    let record: Value =
        serde_json::from_slice(&fs::read(root.join("exclusive.json")).unwrap()).unwrap();
    assert_eq!(record["kind"], "exclusive");
    let next =
        launch(json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":true}))
            .wait_with_output()
            .unwrap();
    assert!(next.status.success());
    let response: Value = serde_json::from_slice(&next.stdout).unwrap();
    assert!(response["result"].is_null());
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(root.join("exclusive.json")).unwrap()).unwrap(),
        record
    );
}
