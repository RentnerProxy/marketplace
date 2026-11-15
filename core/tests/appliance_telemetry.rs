use serde_json::Value;
use std::{
    io::{Read, Write},
    net::TcpStream,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

struct ChildGuard(std::process::Child);
impl std::ops::Deref for ChildGuard {
    type Target = std::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for ChildGuard {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn request(path: &str) -> String {
    let mut socket = TcpStream::connect(("127.0.0.1", 3004)).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    write!(
        socket,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    socket.read_to_string(&mut response).unwrap();
    response
}

fn process_command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_marketplace-appliance"));
    command
        .env_clear()
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    for key in ["SystemRoot", "WINDIR", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    if let Some(profile) = std::env::var_os("LLVM_PROFILE_FILE") {
        command.env("LLVM_PROFILE_FILE", profile);
    }
    command
}

fn appliance(mode: &str) -> Command {
    let mut command = process_command();
    command.arg(mode);
    command
}

fn captured_stderr(child: &mut std::process::Child) -> String {
    let mut output = String::new();
    if let Some(stderr) = child.stderr.take() {
        let _ = stderr.take(8192).read_to_string(&mut output);
    }
    output
}

#[test]
fn standalone_runtime_reports_real_process_and_bounded_sanitized_core_history() {
    assert!(!appliance("invalid-mode").status().unwrap().success());
    let mut default_command = process_command();
    assert!(!default_command.status().unwrap().success());
    assert!(!appliance("start").status().unwrap().success());
    let mut child = ChildGuard(
        appliance("serve")
            .env("VITE_APP_VERSION", "1.2.3-test")
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    while TcpStream::connect(("127.0.0.1", 3004)).is_err() {
        if let Some(status) = child.try_wait().unwrap() {
            panic!(
                "Native runtime failed: {status}: {}",
                captured_stderr(&mut child)
            );
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("Native readiness timeout: {}", captured_stderr(&mut child));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let response = request("/core/health");
    assert!(response.starts_with("HTTP/1.1 200 "));
    let value: Value = serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(value["pid"], child.id());
    assert_eq!(value["status"], "running");
    assert_eq!(value["version"], "1.2.3-test");
    assert!(
        value["version"]
            .as_str()
            .is_some_and(|value| value.len() <= 128)
    );
    assert!(value["uptimeSeconds"].as_u64().is_some());
    let response = request("/logs?service=core");
    let logs: Value = serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(logs["source"], "container");
    assert_eq!(logs["sharedHistoryAvailable"], true);
    assert!(
        logs["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["event"] == "core.started")
    );
    assert!(request("/health").starts_with("HTTP/1.1 200 "));
    assert!(appliance("healthcheck").status().unwrap().success());
    for target in [
        "/logs?service=worker&tail=1000",
        "/logs?service=../etc/passwd",
        "/logs?service=core&service=worker",
        "/logs",
    ] {
        assert!(request(target).starts_with("HTTP/1.1 400 "));
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
    }
    #[cfg(not(unix))]
    child.kill().unwrap();
    let status = child.wait().unwrap();
    #[cfg(unix)]
    assert!(status.success());
    #[cfg(not(unix))]
    let _ = status;
    assert!(TcpStream::connect(("127.0.0.1", 3004)).is_err());
    assert!(!appliance("healthcheck").status().unwrap().success());
}
