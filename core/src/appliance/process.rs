use super::{
    Result,
    environment::{Environment, service_environment},
    logs::{LogStore, MAX_LINE},
};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Postgresql,
    Valkey,
    Webserver,
    Worker,
}
impl Role {
    pub fn name(self) -> &'static str {
        match self {
            Self::Postgresql => "postgresql",
            Self::Valkey => "valkey",
            Self::Webserver => "webserver",
            Self::Worker => "worker",
        }
    }
    pub fn consumer(self) -> bool {
        matches!(self, Self::Webserver | Self::Worker)
    }
    pub fn startup_order(maintenance: bool) -> Vec<Self> {
        if maintenance {
            vec![Self::Postgresql]
        } else {
            vec![
                Self::Postgresql,
                Self::Valkey,
                Self::Webserver,
                Self::Worker,
            ]
        }
    }
}

fn command(program: &str, args: &[&str], env: &Environment) -> Command {
    let mut command = Command::new(program);
    command
        .args(args)
        .env_clear()
        .envs(env)
        .stdin(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

/// Run a scrubbed argument-array command with cancellation, bounded output and a hard deadline.
pub(super) fn execute(
    program: &str,
    args: &[&str],
    env: &Environment,
    timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>> {
    if cancelled.load(Ordering::SeqCst) {
        return Err("appliance_stopping");
    }
    let mut child = command(program, args, env)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "appliance_command_failed")?;
    let stdout = child.stdout.take().ok_or("appliance_command_failed")?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.take(8193).read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        if cancelled.load(Ordering::SeqCst) || Instant::now() >= deadline {
            signal(&mut child, false, true);
            let _ = child.wait();
            let _ = reader.join();
            return Err("appliance_command_timeout");
        }
        match child.try_wait() {
            Ok(Some(status)) if reader.is_finished() => break status,
            Ok(Some(_)) | Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                signal(&mut child, false, true);
                let _ = child.wait();
                let _ = reader.join();
                return Err("appliance_command_failed");
            }
        }
    };
    let output = reader.join().map_err(|_| "appliance_command_failed")?;
    if !status.success() || output.len() > 8192 {
        return Err("appliance_command_failed");
    }
    Ok(output)
}

pub struct ManagedChild {
    role: Role,
    child: Child,
    readers: Vec<JoinHandle<()>>,
    status: Option<bool>,
}
impl ManagedChild {
    fn configured_command(role: Role, env: &Environment) -> Command {
        let mut child_env = service_environment(env);
        let args = match role {
            Role::Postgresql => vec![
                "postgres:postgres",
                "postgres",
                "-D",
                "/data/postgresql/18/docker",
                "-c",
                "listen_addresses=127.0.0.1",
                "-c",
                "port=5432",
                "-c",
                "unix_socket_directories=/run/marketplace/postgresql",
                "-c",
                "logging_collector=off",
                "-c",
                "log_statement=none",
                "-c",
                "log_min_error_statement=panic",
                "-c",
                "log_error_verbosity=terse",
                "-c",
                "log_parameter_max_length=0",
                "-c",
                "log_parameter_max_length_on_error=0",
            ],
            Role::Valkey => {
                child_env.insert("VALKEY_PASSWORD".into(), env["VALKEY_PASSWORD"].clone());
                vec!["valkey:valkey", "valkey-entrypoint.sh", "valkey-server"]
            }
            Role::Webserver => {
                child_env = env.clone();
                vec![
                    "bun:bun",
                    "bun",
                    "--no-env-file",
                    "web/src/server/productionEntrypoint.ts",
                ]
            }
            Role::Worker => {
                child_env = env.clone();
                vec![
                    "bun:bun",
                    "bun",
                    "--no-env-file",
                    "web/src/server/productionWorkerEntrypoint.ts",
                ]
            }
        };
        let mut process = command("su-exec", &args, &child_env);
        process
            .current_dir(if role == Role::Valkey {
                "/run/marketplace/valkey"
            } else {
                "/app"
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        process
    }

    pub fn start(role: Role, env: &Environment, logs: Arc<LogStore>) -> Result<Self> {
        Self::spawn(role, Self::configured_command(role, env), logs)
    }

    fn spawn(role: Role, mut command: Command, logs: Arc<LogStore>) -> Result<Self> {
        let mut child = command
            .spawn()
            .map_err(|_| "appliance_child_spawn_failed")?;
        let stdout = child.stdout.take().ok_or("appliance_log_pipe_failed")?;
        let stderr = child.stderr.take().ok_or("appliance_log_pipe_failed")?;
        let other_logs = logs.clone();
        Ok(Self {
            role,
            child,
            status: None,
            readers: vec![
                thread::spawn(move || forward(stdout, role, false, logs)),
                thread::spawn(move || forward(stderr, role, true, other_logs)),
            ],
        })
    }
    pub fn exited(&mut self) -> bool {
        if self.status.is_none() {
            match self.child.try_wait() {
                Ok(Some(status)) => self.status = Some(status.success()),
                Err(_) => self.status = Some(false),
                Ok(None) => (),
            }
        }
        self.status.is_some()
    }
    pub fn finish(self) {
        let deadline = Instant::now() + Duration::from_secs(2);
        for reader in self.readers {
            while !reader.is_finished() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(10));
            }
            // A blocked external log sink must never extend the appliance shutdown budget.
            if reader.is_finished() {
                let _ = reader.join();
            }
        }
    }
}

fn signal(child: &mut Child, postgres: bool, force: bool) {
    #[cfg(unix)]
    {
        let signal = if force {
            libc::SIGKILL
        } else if postgres {
            libc::SIGINT
        } else {
            libc::SIGTERM
        };
        // Every child starts its own process group; negative PID includes all descendants.
        unsafe {
            libc::kill(-(child.id() as libc::pid_t), signal);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (postgres, force);
        let _ = child.kill();
    }
}

fn signal_consumer(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
}

pub fn stop_children(children: &mut [ManagedChild], consumers: bool, timeout: Duration) -> bool {
    let mut failed = false;
    for child in children
        .iter_mut()
        .filter(|child| child.role.consumer() == consumers)
    {
        if child.exited() {
            continue;
        }
        if consumers {
            // Bun drains its jobs and forwards webserver shutdown itself. Native helpers must
            // complete active work; group SIGTERM would cancel an in-flight archive or restore.
            signal_consumer(&mut child.child);
        } else {
            signal(&mut child.child, child.role == Role::Postgresql, false);
        }
    }
    let deadline = Instant::now() + timeout;
    loop {
        let active = children
            .iter_mut()
            .filter(|child| child.role.consumer() == consumers)
            .any(|child| !child.exited());
        if !active {
            for child in children
                .iter_mut()
                .filter(|child| child.role.consumer() == consumers)
            {
                signal(&mut child.child, false, true);
            }
            break;
        }
        if Instant::now() >= deadline {
            failed = true;
            for child in children
                .iter_mut()
                .filter(|child| child.role.consumer() == consumers)
            {
                signal(&mut child.child, false, true);
                let _ = child.child.wait();
                child.status = Some(false);
            }
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    failed
        || children
            .iter()
            .filter(|child| child.role.consumer() == consumers)
            .any(|child| child.status == Some(false))
}

fn forward(mut stream: impl Read, role: Role, stderr: bool, logs: Arc<LogStore>) {
    let mut buffer = [0u8; 4096];
    let mut pending = Vec::with_capacity(MAX_LINE * 2);
    let mut discarding = false;
    let line = |bytes: &[u8]| {
        let message = String::from_utf8_lossy(bytes);
        let message = message.trim_end_matches('\r');
        logs.append(role.name(), message, stderr);
        // Full setup links remain visible only in the operator's real container output.
        if stderr {
            eprintln!("[{}] {message}", role.name());
        } else {
            println!("[{}] {message}", role.name());
        }
    };
    loop {
        let count = match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        for byte in &buffer[..count] {
            if *byte == b'\n' {
                if !discarding {
                    line(&pending);
                }
                pending.clear();
                discarding = false;
            } else if !discarding {
                pending.push(*byte);
            }
            if pending.len() >= MAX_LINE * 2 {
                // Never expose a secret fragment after splitting an oversized logical line.
                line(b"container_log_line_truncated");
                pending.clear();
                discarding = true;
            }
        }
    }
    if !discarding && !pending.is_empty() {
        line(&pending);
    }
}

pub fn probe(role: Role, env: &Environment) -> bool {
    if role == Role::Webserver {
        return http_probe(3000, "/healthz");
    }
    let mut service_env = service_environment(env);
    service_env.insert("PGCONNECT_TIMEOUT".into(), "3".into());
    service_env.insert("PGPASSWORD".into(), env["POSTGRES_PASSWORD"].clone());
    service_env.insert("VALKEYCLI_AUTH".into(), env["VALKEY_PASSWORD"].clone());
    let (program, args): (&str, Vec<&str>) = match role {
        Role::Postgresql => (
            "psql",
            vec![
                "-X",
                "-h",
                "127.0.0.1",
                "-p",
                "5432",
                "-U",
                &env["POSTGRES_USER"],
                "-d",
                "postgres",
                "-Atqc",
                "SELECT 1",
            ],
        ),
        Role::Valkey => ("valkey-cli", vec!["--raw", "ping"]),
        Role::Worker => {
            service_env = env.clone();
            (
                "su-exec",
                vec![
                    "bun:bun",
                    "bun",
                    "--no-env-file",
                    "web/src/server/workerHealthcheck.ts",
                ],
            )
        }
        Role::Webserver => unreachable!(),
    };
    execute(
        program,
        &args,
        &service_env,
        Duration::from_secs(4),
        &AtomicBool::new(false),
    )
    .is_ok_and(|output| {
        role == Role::Worker
            || String::from_utf8_lossy(&output).trim()
                == if role == Role::Postgresql {
                    "1"
                } else {
                    "PONG"
                }
    })
}

pub fn http_probe(port: u16, path: &str) -> bool {
    http_probe_with_timeout(port, path, Duration::from_secs(3))
}

pub fn http_probe_with_timeout(port: u16, path: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let address: SocketAddr = ([127, 0, 0, 1], port).into();
    let Ok(mut socket) = TcpStream::connect_timeout(&address, timeout) else {
        return false;
    };
    let _ = socket.set_read_timeout(Some(timeout));
    let _ = socket.set_write_timeout(Some(timeout));
    if write!(
        socket,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }
    let mut buffer = [0u8; 64];
    let mut length = 0;
    while length < buffer.len() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return false;
        }
        let _ = socket.set_read_timeout(Some(remaining));
        match socket.read(&mut buffer[length..]) {
            Ok(0) | Err(_) => return false,
            Ok(count) => length += count,
        }
        if buffer[..length].contains(&b'\n') {
            return buffer[..length].starts_with(b"HTTP/1.1 200 ")
                || buffer[..length].starts_with(b"HTTP/1.0 200 ");
        }
    }
    false
}

#[cfg(all(test, unix))]
#[path = "../../tests/unit/appliance_process.rs"]
mod tests;
