use super::*;

fn wait_for_listener_refusal(
    address: std::net::SocketAddr,
    timeout: Duration,
) -> std::io::Result<()> {
    let deadline = Instant::now() + timeout.min(Duration::from_secs(3));
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "The test listener remained reachable after shutdown.",
            ));
        }
        // Parallel process tests can temporarily inherit a CLOEXEC listener
        // until their child execs. Only the kernel's refusal confirms that all
        // copies closed; timeouts or a full backlog must never count as closure.
        // Windows may deliver a closed-loopback refusal after a SYN retry.
        // Use the remaining deadline instead of mistaking a short timeout for it.
        match TcpStream::connect_timeout(&address, remaining) {
            Ok(socket) => drop(socket),
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => return Ok(()),
            Err(error) => return Err(error),
        }
        thread::sleep(remaining.min(Duration::from_millis(5)));
    }
}

#[test]
fn listener_refusal_waits_for_retained_ownership_and_rejects_a_live_listener() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let retained = listener.try_clone().unwrap();
    drop(listener);
    assert!(TcpStream::connect(address).is_ok());
    let started = Instant::now();
    let release = thread::spawn(move || {
        thread::sleep(Duration::from_millis(25));
        drop(retained);
    });
    wait_for_listener_refusal(address, Duration::from_secs(3)).unwrap();
    release.join().unwrap();
    assert!(started.elapsed() >= Duration::from_millis(25));

    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    assert_eq!(
        wait_for_listener_refusal(listener.local_addr().unwrap(), Duration::from_millis(40))
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::TimedOut
    );
}

fn exchange(request: &[u8], healthy: bool) -> String {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        let logs = LogStore::new(Vec::new());
        logs.event("core.started", "info", "Überprüfung läuft");
        logs.append("webserver",r#"{"level":"info","event":"realtime.started","context":{"service":"websocket"},"payload":"private-frame"}"#,false);
        handle(socket, &logs, Instant::now(), || healthy);
    });
    let mut socket = TcpStream::connect(address).unwrap();
    socket.write_all(request).unwrap();
    socket.shutdown(std::net::Shutdown::Write).unwrap();
    let mut response = String::new();
    socket.read_to_string(&mut response).unwrap();
    worker.join().unwrap();
    response
}

#[test]
fn endpoint_routes_reject_mutation_and_invalid_queries_and_preserve_contracts() {
    for (target, status) in [
        ("/health", 503),
        ("/unknown", 404),
        ("/logs", 400),
        ("/logs?service=core&tail=300", 400),
        ("/logs?service=core", 200),
        ("/logs?service=postgresql", 200),
        ("/logs?service=websocket", 200),
        ("/logs?service=websocket&service=worker", 400),
        ("/core/health", 200),
    ] {
        let response = exchange(
            format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes(),
            false,
        );
        assert!(
            response.starts_with(&format!("HTTP/1.1 {status} ")),
            "{response}"
        );
        assert!(response.contains("Cache-Control: no-store"));
        if target == "/logs?service=core" {
            let value: serde_json::Value =
                serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert_eq!(value["entries"][0]["event"], "core.started");
        }
        if target == "/logs?service=websocket" {
            let value: serde_json::Value =
                serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert_eq!(value["entries"][0]["event"], "realtime.started");
            assert_eq!(value["entries"][0]["context"]["service"], "websocket");
            assert!(!response.contains("private-frame"));
        }
    }
    assert!(exchange(b"GET /health HTTP/1.1\r\n\r\n", true).starts_with("HTTP/1.1 200 "));
    assert!(exchange(b"POST /logs HTTP/1.1\r\n\r\n", true).starts_with("HTTP/1.1 405 "));
    assert!(exchange(b"GET /health", true).starts_with("HTTP/1.1 400 "));
    assert!(exchange(&vec![b'x'; 2048], true).starts_with("HTTP/1.1 400 "));
}

#[test]
fn loopback_runtime_owns_its_listener_and_joins_connections_on_stop() {
    let logs = Arc::new(LogStore::new(Vec::new()));
    let ready = Arc::new(AtomicBool::new(true));
    let stopping = Arc::new(AtomicBool::new(false));
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let runtime = start_with_listener(
        listener,
        logs.clone(),
        ready.clone(),
        stopping.clone(),
        Environment::new(),
        false,
        true,
    )
    .unwrap();
    assert!(TcpListener::bind(address).is_err());
    assert!(process::http_probe(address.port(), "/health"));
    stopping.store(true, Ordering::SeqCst);
    assert!(!process::http_probe(address.port(), "/health"));
    runtime.stop();
    wait_for_listener_refusal(address, Duration::from_secs(3)).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let probe = directory.path().join("psql");
        std::fs::write(
            &probe,
            "#!/bin/sh\ntest \"$PGPASSWORD\" = synthetic-password || exit 1\nprintf 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&probe, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut env = crate::appliance::create_environment(
            &[("POSTGRES_PASSWORD".into(), "synthetic-password".into())]
                .into_iter()
                .collect(),
            true,
        )
        .unwrap();
        env.insert("PATH".into(), directory.path().to_str().unwrap().into());
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let production = start_with_listener(
            listener,
            Arc::new(LogStore::new(Vec::new())),
            Arc::new(AtomicBool::new(true)),
            Arc::new(AtomicBool::new(false)),
            env,
            true,
            false,
        )
        .unwrap();
        assert!(process::http_probe(address.port(), "/health"));
        std::fs::write(&probe, "#!/bin/sh\nexit 1\n").unwrap();
        assert!(!process::http_probe(address.port(), "/health"));
        production.stop();
    }
}
