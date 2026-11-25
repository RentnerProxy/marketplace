use super::*;
use marketplace_core::{protocol::OperationContext, storage};
use serde_json::{Value, json};
use std::fs;

struct Output(*mut StorageOutput);

impl Output {
    fn json(&self) -> Value {
        assert!(!self.0.is_null());
        // SAFETY: this guard exclusively owns the execution result until drop.
        let bytes = unsafe {
            slice::from_raw_parts(
                marketplace_storage_output_json(self.0),
                marketplace_storage_output_json_len(self.0) as usize,
            )
        };
        serde_json::from_slice(bytes).unwrap()
    }
}

impl Drop for Output {
    fn drop(&mut self) {
        // SAFETY: the guard consumes the ABI result exactly once.
        unsafe { marketplace_storage_output_free(self.0) };
    }
}

fn execute(request: Value) -> Output {
    let json = serde_json::to_vec(&request).unwrap();
    // SAFETY: the JSON buffer remains initialized and immutable for the call.
    Output(unsafe {
        marketplace_storage_execute(json.as_ptr(), json.len() as u64, ptr::null(), 0, 0)
    })
}

#[test]
fn rejects_invalid_buffer_arguments_and_handles_null_output() {
    assert_eq!(marketplace_storage_abi_version(), 2);
    let json = br#"{"operation":"capacity","requests":[]}"#;
    let null = ptr::null();
    let wrapping = ptr::without_provenance(usize::MAX);
    for (meta, meta_len, binary, binary_len, flag) in [
        (null, 1, null, 0, 0),
        (null, 0, null, 0, 0),
        (null, (MAX_NATIVE_REQUEST_BYTES + 1) as u64, null, 0, 0),
        (wrapping, 1, null, 0, 0),
        (json.as_ptr(), json.len() as u64, null, 1, 0),
        (json.as_ptr(), json.len() as u64, null, 0, 1),
        (json.as_ptr(), json.len() as u64, null, 0, 2),
        (json.as_ptr(), json.len() as u64, json.as_ptr(), 0, 0),
        (json.as_ptr(), json.len() as u64, json.as_ptr(), 1, 1),
    ] {
        // SAFETY: invalid ranges are rejected before forming slices. The only
        // readable pointer passed here borrows the live, immutable JSON array.
        let result = Output(unsafe {
            marketplace_storage_execute(meta, meta_len, binary, binary_len, flag)
        });
        assert_eq!(result.json()["error"]["code"], "CORE_PROTOCOL_ERROR");
    }

    // SAFETY: null is accepted by each result accessor and by free.
    unsafe {
        assert!(marketplace_storage_output_json(ptr::null()).is_null());
        assert_eq!(marketplace_storage_output_json_len(ptr::null()), 0);
        marketplace_storage_output_free(ptr::null_mut());
    }

    let malformed = b"{";
    for (flag, code) in [(0, "CORE_INVALID_REQUEST"), (1, "CORE_PROTOCOL_ERROR")] {
        // SAFETY: the metadata points to the live, immutable one-byte array.
        let result = Output(unsafe {
            marketplace_storage_execute(malformed.as_ptr(), malformed.len() as u64, null, 0, flag)
        });
        assert_eq!(result.json()["error"]["code"], code);
    }
}

#[test]
fn rejects_non_native_operations_and_large_batches_before_mutation() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("untouched");
    for operation in [
        "backupDeleteFiles",
        "backupPreparePaths",
        "backupPublishFile",
        "brandingPublish",
        "fenceAcquireExclusive",
        "fenceAdmitShared",
        "fenceDrain",
        "fenceRelease",
        "journalSession",
        "permissions",
        "postgresDump",
        "postgresRestore",
        "prepareDirectories",
        "readBackgroundRepresentation",
        "recoveryFinish",
        "recoveryPrepare",
        "remove",
        "restoreStateWrite",
        "syncDirectory",
        "syncFile",
        "syncTree",
        "tempDirectory",
        "writeFile",
    ] {
        let output = execute(json!({"operation": operation, "rootDirectory": root}));
        assert_eq!(output.json()["error"]["code"], "CORE_INVALID_OPERATION");
    }
    for requests in [
        vec![json!({"directoryPath": dir.path(), "sourcePaths": []}); 33],
        vec![json!({"directoryPath": dir.path(), "sourcePaths": [dir.path()]})],
    ] {
        let output = execute(json!({"operation":"capacity","requests":requests}));
        assert_eq!(output.json()["error"]["code"], "CORE_INVALID_OPERATION");
    }
    assert!(!root.exists());
    assert_eq!(
        execute(json!({"operation":"capacity","requests":[]})).json(),
        json!({"type":"result","result":{"ok":true}})
    );
    assert_eq!(
        execute(json!({"operation":"capacity","requests":[],"binaryLengths":[0]})).json()["error"]
            ["code"],
        "CORE_INVALID_OPERATION"
    );
}

#[test]
fn stat_reads_only_the_private_file_and_rejects_legacy_migration() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("storage");
    let path = root.join("backgrounds/current.webp");
    let legacy = dir.path().join("current.webp");
    fs::write(&legacy, b"legacy").unwrap();
    let stat = json!({
        "operation": "statBackground",
        "rootDirectory": root,
        "directoryPath": path.parent().unwrap(),
        "filePath": path
    });
    let mut migrating = stat.clone();
    migrating["legacyRoot"] = json!(dir.path());
    migrating["legacyPath"] = json!(legacy);
    assert_eq!(
        execute(migrating).json()["error"]["code"],
        "CORE_INVALID_OPERATION"
    );
    assert_eq!(
        execute(stat.clone()).json(),
        json!({"type":"result","result":null})
    );
    assert_eq!(fs::read(legacy).unwrap(), b"legacy");
    assert!(!root.exists());

    let context = OperationContext::cleanup();
    storage::execute_worker(
        &json!({"operation":"writeFile","rootDirectory":root,"filePath":path}),
        Some(b"private"),
        &context,
    )
    .unwrap();
    let output = execute(stat.clone());
    assert_eq!(output.json()["type"], "result");
    assert_eq!(output.json()["result"]["size"], 7);
    assert_eq!(
        output.json()["result"]["version"].as_str().unwrap().len(),
        64
    );
    assert_eq!(
        output.json()["result"],
        storage::execute_ref(&stat, &context).unwrap()
    );
}

#[test]
fn missing_restore_state_does_not_create_directories() {
    let dir = tempfile::tempdir().unwrap();
    let backup = dir.path().join("backup");
    let storage = dir.path().join("storage");
    let output = execute(
        json!({"operation":"restoreStateGet","backupDirectory":backup,"storageDirectory":storage}),
    );
    assert_eq!(output.json(), json!({"type":"result","result":null}));
    assert!(!backup.exists());
    assert!(!storage.exists());
}
