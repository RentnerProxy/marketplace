use super::*;
use std::{fs, os::unix::process::CommandExt};

fn wait_fixture_executable(path: &std::path::Path) -> std::io::Result<()> {
    retry_fixture_executable(|| {
        Command::new(path)
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|_| ())
    })
}

fn retry_fixture_executable(
    mut attempt: impl FnMut() -> std::io::Result<()>,
) -> std::io::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        // Another parallel test can fork while this script is being
        // published. Its inherited CLOEXEC writer survives until exec,
        // temporarily making the script unexecutable on Linux (ETXTBSY).
        // Prime the immutable fixture before testing the actual probe;
        // exit status is irrelevant here because no credentials are set.
        match attempt() {
            Ok(()) => return Ok(()),
            Err(error)
                if error.raw_os_error() == Some(libc::ETXTBSY) && Instant::now() < deadline =>
            {
                thread::sleep(Duration::from_millis(5));
            }
            Err(error) => return Err(error),
        }
    }
}

#[test]
fn fixture_publication_waits_only_for_busy_executables() {
    // A real held writer can leak into other concurrently forking test
    // children and outlive its owner's release. Inject the kernel errors
    // instead so this regression does not create the race it verifies.
    let mut attempts = 0;
    retry_fixture_executable(|| {
        attempts += 1;
        if attempts < 3 {
            Err(std::io::Error::from_raw_os_error(libc::ETXTBSY))
        } else {
            Ok(())
        }
    })
    .unwrap();
    assert_eq!(attempts, 3);
    for kind in [
        std::io::ErrorKind::PermissionDenied,
        std::io::ErrorKind::NotFound,
    ] {
        let mut attempts = 0;
        let error = retry_fixture_executable(|| {
            attempts += 1;
            Err(std::io::Error::from(kind))
        })
        .unwrap_err();
        assert_eq!(error.kind(), kind);
        assert_eq!(attempts, 1);
    }
}

fn fixture(role: Role, script: &str, path: &std::path::Path) -> ManagedChild {
    let child = Command::new("/bin/sh")
        .args(["-c", script])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("FIXTURE", path)
        .process_group(0)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    ManagedChild {
        role,
        child,
        readers: Vec::new(),
        status: None,
    }
}

fn wait_file(path: &std::path::Path) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !path.exists() {
        assert!(Instant::now() < deadline, "fixture startup timed out");
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn consumers_drain_before_services_and_postgres_receives_fast_shutdown() {
    let directory = tempfile::tempdir().unwrap();
    let mut children = vec![
        fixture(
            Role::Postgresql,
            r#"trap 'echo fast > "$FIXTURE/postgres-stopped"; exit 0' INT; trap 'exit 9' TERM; touch "$FIXTURE/postgres-ready"; while :; do sleep 0.1; done"#,
            directory.path(),
        ),
        fixture(
            Role::Worker,
            r#"trap 'test -e "$FIXTURE/postgres-ready" && test ! -e "$FIXTURE/postgres-stopped" && echo drained > "$FIXTURE/consumer-drained"; exit 0' TERM; touch "$FIXTURE/consumer-ready"; while :; do sleep 0.1; done"#,
            directory.path(),
        ),
    ];
    wait_file(&directory.path().join("postgres-ready"));
    wait_file(&directory.path().join("consumer-ready"));
    assert!(!stop_children(&mut children, true, Duration::from_secs(3)));
    assert!(directory.path().join("consumer-drained").exists());
    assert!(!directory.path().join("postgres-stopped").exists());
    assert!(!stop_children(&mut children, false, Duration::from_secs(3)));
    assert_eq!(
        fs::read_to_string(directory.path().join("postgres-stopped"))
            .unwrap()
            .trim(),
        "fast"
    );
}

#[test]
fn idle_consumer_exits_promptly_without_waiting_for_the_shutdown_deadline() {
    let directory = tempfile::tempdir().unwrap();
    let mut children = vec![fixture(
        Role::Worker,
        r#"trap 'exit 0' TERM; touch "$FIXTURE/ready"; while :; do sleep 0.1; done"#,
        directory.path(),
    )];
    let pid = children[0].child.id() as libc::pid_t;
    wait_file(&directory.path().join("ready"));
    let (sender, receiver) = std::sync::mpsc::channel();
    let worker = thread::spawn(move || {
        let started = Instant::now();
        let failed = stop_children(&mut children, true, Duration::from_secs(60));
        let _ = sender.send((failed, started.elapsed()));
    });
    let (failed, elapsed) = match receiver.recv_timeout(Duration::from_secs(3)) {
        Ok(result) => result,
        Err(error) => {
            // The fixture exclusively owns this process group. A regression must
            // neither retain its processes nor make this test wait the full budget.
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
            panic!("idle consumer shutdown did not complete promptly: {error}");
        }
    };
    worker.join().unwrap();
    assert!(!failed);
    assert!(
        elapsed < Duration::from_secs(2),
        "shutdown took {elapsed:?}"
    );
}

#[test]
fn shutdown_deadline_kills_uncooperative_process_group() {
    let directory = tempfile::tempdir().unwrap();
    let mut children = vec![fixture(
        Role::Worker,
        r#"trap '' TERM; touch "$FIXTURE/ready"; while :; do sleep 0.1; done"#,
        directory.path(),
    )];
    wait_file(&directory.path().join("ready"));
    assert!(stop_children(
        &mut children,
        true,
        Duration::from_millis(100)
    ));
    assert!(children[0].exited());
}

#[test]
fn graceful_consumer_drain_does_not_cancel_an_active_native_helper() {
    let directory = tempfile::tempdir().unwrap();
    let mut children = vec![fixture(
        Role::Worker,
        r#"
            trap 'wait "$helper"; test -f "$FIXTURE/helper-finished" && exit 0; exit 12' TERM
            /bin/sh -c 'trap '\''echo cancelled > "$FIXTURE/helper-cancelled"; exit 9'\'' TERM; touch "$FIXTURE/helper-ready"; sleep 0.3; touch "$FIXTURE/helper-finished"' &
            helper=$!
            touch "$FIXTURE/consumer-ready"
            wait "$helper"
            while :; do sleep 0.1; done
        "#,
        directory.path(),
    )];
    wait_file(&directory.path().join("consumer-ready"));
    wait_file(&directory.path().join("helper-ready"));
    assert!(!stop_children(&mut children, true, Duration::from_secs(3)));
    assert!(directory.path().join("helper-finished").exists());
    assert!(!directory.path().join("helper-cancelled").exists());
}

#[test]
fn command_output_and_time_are_bounded_without_shell_interpolation() {
    let env = Environment::new();
    let cancelled = AtomicBool::new(false);
    assert!(
        execute(
            "/bin/sh",
            &[
                "-c",
                "while :; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; done"
            ],
            &env,
            Duration::from_millis(200),
            &cancelled
        )
        .is_err()
    );
    assert!(
        execute(
            "/bin/sh",
            &["-c", "sleep 5"],
            &env,
            Duration::from_millis(100),
            &cancelled
        )
        .is_err()
    );
    assert_eq!(
        execute(
            "/bin/sh",
            &["-c", "printf '%s' \"$1\"", "fixture", "Überprüfung ä läuft"],
            &env,
            Duration::from_secs(1),
            &cancelled
        )
        .unwrap(),
        "Überprüfung ä läuft".as_bytes()
    );
    assert!(
        execute(
            "/definitely-missing-appliance-command",
            &[],
            &env,
            Duration::from_secs(1),
            &cancelled
        )
        .is_err()
    );
    assert!(
        execute(
            "/bin/sh",
            &["-c", "sleep 5 & exit 0"],
            &env,
            Duration::from_millis(100),
            &cancelled
        )
        .is_err()
    );
    assert!(
        execute(
            "/bin/sleep",
            &["5"],
            &env,
            Duration::from_secs(1),
            &AtomicBool::new(true)
        )
        .is_err()
    );
}

#[test]
fn streamed_logs_keep_utf8_and_drop_oversized_secret_fragments() {
    let logs = Arc::new(LogStore::new(vec!["synthetic-secret".into()]));
    let message = format!(
        "Überprüfung läuft\n{}synthetic-secret\n{{\"level\":\"warn\"}}\r\nERROR native failure\nlast line",
        "ä".repeat(10000)
    );
    forward(message.as_bytes(), Role::Postgresql, true, logs.clone());
    let snapshot = logs.snapshot("postgresql");
    let entries = snapshot["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 5);
    assert_eq!(entries[0]["message"], "Überprüfung läuft");
    assert_eq!(entries[1]["message"], "container_log_line_truncated");
    assert_eq!(entries[2]["level"], "warn");
    assert_eq!(entries[3]["level"], "error");
    assert_eq!(entries[4]["message"], "last line");
    assert!(!snapshot.to_string().contains("synthetic-secret"));
}

#[test]
fn production_commands_drop_privileges_and_scrub_database_and_cache_environments() {
    let env = crate::appliance::create_environment(
        &[("POSTGRES_PASSWORD".into(), "synthetic-password".into())]
            .into_iter()
            .collect(),
        true,
    )
    .unwrap();
    for role in Role::startup_order(false) {
        let command = ManagedChild::configured_command(role, &env);
        assert_eq!(command.get_program(), "su-exec");
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_str().unwrap())
            .collect();
        let child_env: std::collections::BTreeMap<_, _> = command
            .get_envs()
            .map(|(key, value)| (key.to_str().unwrap(), value.unwrap().to_str().unwrap()))
            .collect();
        if role.consumer() {
            let script = if role == Role::Webserver {
                "runtime/productionEntrypoint.js"
            } else {
                "runtime/productionWorkerEntrypoint.js"
            };
            assert_eq!(args, ["bun:bun", "bun", "--no-env-file", script]);
            assert_eq!(child_env["POSTGRES_PASSWORD"], "synthetic-password");
        } else if role == Role::Postgresql {
            assert_eq!(args[0], "postgres:postgres");
            assert!(
                args.windows(2)
                    .any(|args| args == ["-c", "idle_in_transaction_session_timeout=60000"])
            );
            assert!(!args.iter().any(|arg| arg.starts_with("statement_timeout=")));
            assert_eq!(child_env.len(), 2);
            assert!(!child_env.contains_key("POSTGRES_PASSWORD"));
        } else {
            assert_eq!(args[0], "valkey:valkey");
            assert_eq!(child_env.len(), 3);
            assert_eq!(child_env["VALKEY_PASSWORD"], "synthetic-password");
        }
        assert!(!args.contains(&"synthetic-password"));
    }
}

#[test]
fn managed_process_collects_both_streams_and_propagates_spawn_errors() {
    let logs = Arc::new(LogStore::new(Vec::new()));
    let mut process = command(
        "/bin/sh",
        &["-c", "printf 'stdout\\n'; printf 'WARNING stderr\\n' >&2"],
        &Environment::new(),
    );
    process.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = ManagedChild::spawn(Role::Worker, process, logs.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while !child.exited() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(10));
    }
    child.finish();
    let snapshot = logs.snapshot("worker");
    let entries = snapshot["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert!(
        entries
            .iter()
            .any(|entry| entry["event"] == "container.stdout")
    );
    assert!(
        entries
            .iter()
            .any(|entry| entry["event"] == "container.stderr" && entry["level"] == "warn")
    );
    assert!(
        ManagedChild::spawn(
            Role::Worker,
            command("/missing-command", &[], &Environment::new()),
            logs
        )
        .is_err()
    );
}

#[test]
fn dependency_readiness_requires_success_and_the_exact_authenticated_probe_result() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let mut env = crate::appliance::create_environment(
        &[("POSTGRES_PASSWORD".into(), "synthetic-password".into())]
            .into_iter()
            .collect(),
        true,
    )
    .unwrap();
    env.insert("PATH".into(), directory.path().to_str().unwrap().into());
    let executable = |name: &str, body: &str| {
        let path = directory.path().join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        wait_fixture_executable(&path).unwrap();
    };
    executable(
        "psql",
        "test \"$PGPASSWORD\" = synthetic-password || exit 1; printf 1",
    );
    executable(
        "valkey-cli",
        "test \"$VALKEYCLI_AUTH\" = synthetic-password || exit 1; printf PONG",
    );
    assert!(probe(Role::Postgresql, &env));
    assert!(probe(Role::Valkey, &env));
    executable("psql", "printf wrong");
    assert!(!probe(Role::Postgresql, &env));
    executable("valkey-cli", "exit 1");
    assert!(!probe(Role::Valkey, &env));
}

#[test]
fn http_readiness_accepts_fragmented_status_lines_and_rejects_incomplete_or_unhealthy_responses() {
    for (parts, expected) in [
        (vec!["HTTP/1.1 ", "2", "0", "0", " OK\r\n"], true),
        (vec!["HTTP/1.0 ", "200 OK\r\n"], true),
        (vec!["HTTP/1.1 ", "503 Unavailable\r\n"], false),
        (vec!["HTTP/1.1 200 "], false),
        (
            vec![
                "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            ],
            false,
        ),
    ] {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 256];
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let count = socket.read(&mut buffer).unwrap();
                if count == 0 {
                    return;
                }
                request.extend_from_slice(&buffer[..count]);
            }
            for part in parts {
                socket.write_all(part.as_bytes()).unwrap();
                thread::sleep(Duration::from_millis(5));
            }
        });
        assert_eq!(http_probe(port, "/health"), expected);
        worker.join().unwrap();
    }
}
