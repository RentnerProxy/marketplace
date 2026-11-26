//! Real executable boundary tests use only isolated fixtures and stdin JSON.
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};

fn command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_marketplace-storage"));
    command
        .env_remove("MARKETPLACE_CORE_CANCEL_FILE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}
fn invoke(input: &[u8]) -> (bool, Vec<Value>) {
    let mut child = command().spawn().unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.stderr.is_empty());
    let messages = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    (output.status.success(), messages)
}
fn fixture() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[test]
fn storage_binary_reads_background_metadata_without_payload() {
    let fixture = fixture();
    let root = fixture.path().join("private");
    let directory = root.join("images");
    let path = directory.join("background.webp");
    let (success, _) = invoke(&serde_json::to_vec(&json!({"operation":"prepareDirectories","rootDirectory":root,"directoryPath":directory})).unwrap());
    assert!(success);
    std::fs::write(&path, [1, 2, 3]).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let (success, messages) = invoke(
        &serde_json::to_vec(&json!({"operation":"statBackground","rootDirectory":root,"directoryPath":directory,"filePath":path}))
            .unwrap(),
    );
    assert!(success);
    let result = &messages.last().unwrap()["result"];
    assert_eq!(result["size"], 3);
    assert_eq!(result["version"].as_str().unwrap().len(), 64);
}

#[test]
fn storage_binary_returns_structured_secret_free_request_errors() {
    for (input, expected) in [
        (
            b"not-json-synthetic-secret".as_slice(),
            "CORE_INVALID_REQUEST",
        ),
        (
            b"{\"operation\":\"unknown\",\"password\":\"synthetic-secret\"}".as_slice(),
            "CORE_INVALID_OPERATION",
        ),
    ] {
        let (success, messages) = invoke(input);
        assert!(!success);
        let message = messages.last().unwrap();
        assert_eq!(message["type"], "error");
        assert_eq!(message["error"]["code"], expected);
        assert!(!message.to_string().contains("synthetic-secret"));
    }
}

#[test]
fn storage_binary_observes_private_cooperative_cancellation_marker() {
    let fixture = fixture();
    let marker = fixture.path().join("cancel");
    std::fs::write(&marker, []).unwrap();
    let mut command = command();
    command.env("MARKETPLACE_CORE_CANCEL_FILE", marker);
    let mut child = command.spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"{\"operation\":\"unknown\"}")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    let message: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(message["error"]["code"], "CORE_CANCELLED");
}

#[test]
fn storage_binary_bounds_request_memory_before_parsing() {
    let mut child = command().spawn().unwrap();
    let mut input = child.stdin.take().unwrap();
    let block = [b' '; 64 * 1024];
    for _ in 0..1024 {
        input.write_all(&block).unwrap();
    }
    let _ = input.write_all(b" ");
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    let message: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(message["error"]["code"], "CORE_REQUEST_TOO_LARGE");
}
