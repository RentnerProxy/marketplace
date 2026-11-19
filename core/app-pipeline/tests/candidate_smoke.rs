#![cfg(feature = "smoke-probe")]

use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn dedicated_smoke_binary_only_accepts_the_probe_operation() {
    let result = Command::new(env!("CARGO_BIN_EXE_candidate-smoke"))
        .arg("smoke-bootstrap")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    assert_eq!(
        String::from_utf8_lossy(&result.stderr).trim(),
        "Expected the smoke-probe operation"
    );
}

#[test]
fn dedicated_smoke_binary_checks_the_probe_input() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_candidate-smoke"))
        .arg("smoke-probe")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"null").unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    let expected = if cfg!(unix) {
        "Invalid runtime bootstrap"
    } else {
        "Candidate runtime probe requires Unix sockets"
    };
    assert_eq!(String::from_utf8_lossy(&result.stderr).trim(), expected);
}
