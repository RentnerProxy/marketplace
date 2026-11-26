use super::{
    Result,
    environment::Environment,
    logs::LogStore,
    process::{self, Role},
};
use serde_json::json;
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[cfg(target_os = "linux")]
fn set_accept_timeout(listener: &TcpListener) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;

    // Bound shutdown even if resource exhaustion prevents the wake connection.
    let timeout = libc::timeval {
        tv_sec: 1,
        tv_usec: 0,
    };
    // SAFETY: The socket is live and timeout points to an initialized timeval of the supplied size.
    let result = unsafe {
        libc::setsockopt(
            listener.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_RCVTIMEO,
            std::ptr::from_ref(&timeout).cast(),
            std::mem::size_of_val(&timeout) as libc::socklen_t,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

pub struct Runtime {
    shutdown: Arc<AtomicBool>,
    address: SocketAddr,
    thread: JoinHandle<()>,
}
impl Runtime {
    pub fn stop(self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // The accept loop checks the flag again after each connection. If the
        // backlog is already full, its queued connections also wake the loop.
        let _ = TcpStream::connect_timeout(&self.address, Duration::from_secs(1));
        let _ = self.thread.join();
    }
}

pub fn start(
    logs: Arc<LogStore>,
    ready: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    env: Environment,
    maintenance: bool,
    standalone: bool,
) -> Result<Runtime> {
    let listener =
        TcpListener::bind(("127.0.0.1", 3004)).map_err(|_| "appliance_telemetry_bind_failed")?;
    start_with_listener(
        listener,
        logs,
        ready,
        stopping,
        env,
        maintenance,
        standalone,
    )
}

fn start_with_listener(
    listener: TcpListener,
    logs: Arc<LogStore>,
    ready: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    env: Environment,
    maintenance: bool,
    standalone: bool,
) -> Result<Runtime> {
    #[cfg(target_os = "linux")]
    set_accept_timeout(&listener).map_err(|_| "appliance_telemetry_failed")?;
    let address = listener
        .local_addr()
        .map_err(|_| "appliance_telemetry_failed")?;
    let shutdown = Arc::new(AtomicBool::new(false));
    let done = shutdown.clone();
    let start = Instant::now();
    let env = Arc::new(env);
    let thread = thread::spawn(move || {
        let mut workers: Vec<JoinHandle<()>> = Vec::new();
        while !done.load(Ordering::SeqCst) {
            let socket = match listener.accept() {
                Ok((socket, _)) => socket,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
                    ) =>
                {
                    continue;
                }
                Err(_) => {
                    stopping.store(true, Ordering::SeqCst);
                    break;
                }
            };
            if done.load(Ordering::SeqCst) {
                break;
            }
            let mut index = 0;
            while index < workers.len() {
                if workers[index].is_finished() {
                    let _ = workers.swap_remove(index).join();
                } else {
                    index += 1;
                }
            }
            if workers.len() >= 8 {
                continue;
            }
            let logs = logs.clone();
            let ready = ready.clone();
            let stopping = stopping.clone();
            let env = env.clone();
            workers.push(thread::spawn(move || {
                handle(socket, &logs, start, || {
                    if !ready.load(Ordering::SeqCst) || stopping.load(Ordering::SeqCst) {
                        return false;
                    }
                    if standalone {
                        return true;
                    }
                    thread::scope(|scope| {
                        Role::startup_order(maintenance)
                            .into_iter()
                            .map(|role| {
                                let env = &env;
                                scope.spawn(move || process::probe(role, env))
                            })
                            .collect::<Vec<_>>()
                            .into_iter()
                            .all(|worker| worker.join().unwrap_or(false))
                    })
                });
            }));
        }
        for worker in workers {
            let _ = worker.join();
        }
    });
    Ok(Runtime {
        shutdown,
        address,
        thread,
    })
}

fn handle(mut socket: TcpStream, logs: &LogStore, start: Instant, healthy: impl FnOnce() -> bool) {
    let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = socket.set_write_timeout(Some(Duration::from_secs(2)));
    let mut request = Vec::with_capacity(1024);
    let deadline = Instant::now() + Duration::from_secs(2);
    let valid = loop {
        if Instant::now() >= deadline || request.len() >= 2048 {
            break false;
        }
        let mut buffer = [0u8; 256];
        match socket.read(&mut buffer) {
            Ok(0) | Err(_) => break false,
            Ok(count) => {
                request.extend_from_slice(&buffer[..count]);
                if request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    break true;
                }
            }
        }
    };
    let request = String::from_utf8_lossy(&request);
    let mut parts = request
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    let (status, body) = if !valid {
        (400, String::new())
    } else if method != "GET" {
        (405, String::new())
    } else if target == "/core/health" {
        let version = std::env::var("VITE_APP_VERSION")
            .ok()
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= 128
                    && value.chars().all(|character| {
                        character.is_ascii_alphanumeric() || ".-_+".contains(character)
                    })
            })
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").into());
        (200, json!({"version":version,"pid":std::process::id(),"uptimeSeconds":start.elapsed().as_secs(),"status":"running"}).to_string())
    } else if target == "/health" {
        (if healthy() { 200 } else { 503 }, String::new())
    } else if let Some(role) = target.strip_prefix("/logs?service=") {
        if matches!(
            role,
            "core" | "websocket" | "postgresql" | "valkey" | "webserver" | "worker"
        ) {
            (200, logs.snapshot(role).to_string())
        } else {
            (400, String::new())
        }
    } else if target.starts_with("/logs") {
        (400, String::new())
    } else {
        (404, String::new())
    };
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Service Unavailable",
    };
    let _ = write!(
        socket,
        "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nAllow: GET\r\n\r\n{body}",
        body.len()
    );
}

#[cfg(test)]
#[path = "../../tests/unit/appliance_telemetry.rs"]
mod tests;
