use super::*;
use std::net::Shutdown;
use std::os::unix::fs::symlink;

fn fixture() -> Bootstrap {
    Bootstrap {
        app_id: "rentnerproxy.reference".into(),
        installation_id: "candidate-smoke".into(),
        generation: 17,
        runtime_profile: "rentnerproxy-linux-v1".into(),
        versions: json!({"platformApi": "1.0.0", "appProtocol": "1.0.0"}),
        app_socket: APP_SOCKET.into(),
        core_socket: CORE_SOCKET.into(),
        app_credential: "a".repeat(64),
        core_credential: "b".repeat(64),
    }
}

fn accept_before(listener: &UnixListener, deadline: Instant) -> UnixStream {
    loop {
        match listener.accept() {
            Ok((stream, _)) => return stream,
            Err(error)
                if error.kind() == io::ErrorKind::WouldBlock && Instant::now() < deadline =>
            {
                thread::sleep(Duration::from_millis(5));
            }
            Err(error) => panic!("test listener failed: {error}"),
        }
    }
}

fn socket_directory() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("marketplace-smoke-")
        .tempdir_in("/tmp")
        .unwrap()
}

fn probe_with_test_app(readiness: &Value) -> io::Result<()> {
    let directory = socket_directory();
    let manifest_path = directory.path().join("app.json");
    let app_directory = directory.path().join("app");
    let app_path = app_directory.join("app.sock");
    let core_path = directory.path().join("core/core.sock");
    fs::create_dir(&app_directory).unwrap();
    let listener = UnixListener::bind(&app_path).unwrap();
    listener.set_nonblocking(true).unwrap();
    let uid = fs::symlink_metadata(&app_path).unwrap().uid();

    let mut manifest: Value = serde_json::from_str(include_str!(
        "../../../../.github/scripts/ci/fixtures/app-candidate/v1/manifest.json"
    ))
    .unwrap();
    manifest["target"] = "linux-amd64".into();
    manifest["source"] = json!({"repositoryId":"8001234", "commit":"a".repeat(40)});
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();

    let bootstrap = fixture();
    let descriptor = json!({
        "formatVersion": 1,
        "appId": manifest["id"],
        "installationId": bootstrap.installation_id,
        "generation": bootstrap.generation,
        "runtimeProfile": bootstrap.runtime_profile,
        "versions": {"platformApi": "1.0.0", "appProtocol": "1.0.0", "uiBridge": "1.0.0"},
        "appSocket": app_path,
        "coreSocket": core_path,
        "appCredential": bootstrap.app_credential,
        "coreCredential": bootstrap.core_credential,
    });
    let layout = Fixture {
        manifest: &manifest_path,
        app: AppEndpoint {
            path: &app_path,
            uid,
        },
        core: &core_path,
    };
    let deadline = Instant::now() + Duration::from_secs(8);
    let result = thread::scope(|scope| {
        let app = scope.spawn(|| {
            let healthy = json!({"healthy":true});
            for (operation, payload) in [
                (HttpOperation::GetAppHealth, &healthy),
                (HttpOperation::GetAppReadiness, readiness),
            ] {
                let stream = accept_before(&listener, deadline);
                let mut app = BufReader::new(DeadlineStream::new(stream, SOCKET_TIMEOUT));
                let request = head(&mut app).unwrap();
                let mut slots = [httparse::EMPTY_HEADER; 48];
                let mut parsed = httparse::Request::new(&mut slots);
                assert!(parsed.parse(&request).unwrap().is_complete());
                assert_eq!(parsed.path, Some(operation.descriptor().path));
                let bearer = format!("Bearer {}", bootstrap.app_credential);
                assert!(header(parsed.headers, "authorization").unwrap() == Some(bearer.as_str()));
                if operation == HttpOperation::GetAppReadiness {
                    let mut core = DeadlineStream::new(UnixStream::connect(&core_path).unwrap(), SOCKET_TIMEOUT);
                    write!(core,
                        "GET {} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {}\r\nX-App-Installation: {}\r\nX-App-Generation: {}\r\n\r\n",
                        HttpOperation::GetPlatformContext.descriptor().path,
                        bootstrap.core_credential, bootstrap.installation_id, bootstrap.generation,
                    ).unwrap();
                    let (status, context) = read_response(&mut BufReader::new(core)).unwrap();
                    assert_eq!(status, 200);
                    assert_eq!(context["appId"], manifest["id"]);
                    assert_eq!(context["generation"], bootstrap.generation);
                    assert_eq!(context["capabilities"], manifest["capabilities"]);
                    assert!(context.get("coreCredential").is_none());
                    assert!(context.get("appCredential").is_none());
                }
                respond(app.get_mut(), "200 OK", &serde_json::to_vec(payload).unwrap()).unwrap();
            }
        });
        let result = probe_fixture(descriptor, &layout);
        app.join().unwrap();
        result
    });
    assert_eq!(
        fs::symlink_metadata(&core_path).unwrap().mode() & 0o777,
        0o660
    );
    assert_eq!(
        UnixStream::connect(&core_path).err().unwrap().kind(),
        io::ErrorKind::ConnectionRefused
    );
    result
}

#[test]
fn full_probe_requires_app_and_core_readiness_with_manifest_identity() {
    let mut ready = json!({"ready":true,"protocolVersion":"1.0.0","dataVersion":1,"providers":[]});
    probe_with_test_app(&ready).unwrap();
    ready["dataVersion"] = 2.into();
    let error = probe_with_test_app(&ready).unwrap_err();
    assert_eq!(
        error.to_string(),
        "App readiness disagrees with the declared data version"
    );
    ready["dataVersion"] = 1.into();
    ready["providers"] =
        json!([{"id":"fixture-provider", "profile":"monitoring", "version":"1.0.0"}]);
    let error = probe_with_test_app(&ready).unwrap_err();
    assert_eq!(
        error.to_string(),
        "App readiness disagrees with the declared provider profiles"
    );
}

fn core_response(
    bootstrap: &Bootstrap,
    method: &str,
    authorization: &str,
    generation: u64,
    body: &str,
) -> String {
    let path = HttpOperation::GetPlatformContext.descriptor().path;
    let request = format!(
        "{method} {path}?fixture=1 HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {authorization}\r\nX-App-Installation: candidate-smoke\r\nX-App-Generation: {generation}\r\n{body}"
    );
    let (server, mut client) = UnixStream::pair().unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    thread::scope(|scope| {
        let server = scope.spawn(|| context_request(server, bootstrap, b"{\"context\":true}"));
        client.write_all(request.as_bytes()).unwrap();
        client.shutdown(Shutdown::Write).unwrap();
        let mut output = String::new();
        client.read_to_string(&mut output).unwrap();
        server.join().unwrap().unwrap();
        assert!(!output.contains(&bootstrap.app_credential));
        assert!(!output.contains(&bootstrap.core_credential));
        output
    })
}

#[test]
fn core_context_requires_correct_role_installation_and_generation() {
    let bootstrap = fixture();
    let core = &bootstrap.core_credential;
    let output = core_response(&bootstrap, "GET", core, 17, "\r\n");
    assert!(output.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(output.ends_with("{\"context\":true}"));
    assert!(
        core_response(&bootstrap, "GET", &bootstrap.app_credential, 17, "\r\n")
            .starts_with("HTTP/1.1 403 ")
    );
    assert!(core_response(&bootstrap, "GET", core, 16, "\r\n").starts_with("HTTP/1.1 403 "));
    assert!(
        core_response(
            &bootstrap,
            "GET",
            core,
            17,
            "X-App-Installation: repeated\r\n\r\n"
        )
        .starts_with("HTTP/1.1 403 ")
    );
    assert!(core_response(&bootstrap, "POST", core, 17, "\r\n").starts_with("HTTP/1.1 404 "));
}

#[test]
fn core_context_applies_the_request_body_limit_before_serving() {
    let bootstrap = fixture();
    let core = &bootstrap.core_credential;
    for body in [
        "Content-Length: 2\r\n\r\n{}",
        "Transfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
    ] {
        assert!(core_response(&bootstrap, "GET", core, 17, body).starts_with("HTTP/1.1 200 "));
    }
    assert!(
        core_response(&bootstrap, "GET", core, 17, "Content-Length: 4097\r\n\r\n")
            .starts_with("HTTP/1.1 413 ")
    );
    assert!(
        core_response(
            &bootstrap,
            "GET",
            core,
            17,
            "Transfer-Encoding: chunked\r\n\r\n1001\r\n"
        )
        .starts_with("HTTP/1.1 413 ")
    );
    assert!(
        core_response(
            &bootstrap,
            "GET",
            core,
            17,
            "Content-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n"
        )
        .starts_with("HTTP/1.1 400 ")
    );
}

#[test]
fn readiness_checks_socket_ownership_sends_credentials_and_waits_for_a_valid_reply() {
    let directory = socket_directory();
    let path = directory.path().join("app.sock");
    let alias = directory.path().join("alias.sock");
    let unix = UnixListener::bind(&path).unwrap();
    unix.set_nonblocking(true).unwrap();
    symlink(&path, &alias).unwrap();
    let uid = fs::symlink_metadata(&path).unwrap().uid();
    assert!(AppEndpoint { path: &alias, uid }.connect().is_err());
    assert!(
        AppEndpoint {
            path: &path,
            uid: uid.wrapping_add(1)
        }
        .connect()
        .is_err()
    );

    let bootstrap = fixture();
    let protocol = ProtocolContracts::new().unwrap();
    let endpoint = AppEndpoint { path: &path, uid };
    let deadline = Instant::now() + Duration::from_secs(4);
    thread::scope(|scope| {
        let server = scope.spawn(|| {
            for (status, ready) in [("503 Service Unavailable", false), ("200 OK", true)] {
                let stream = loop {
                    match unix.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error)
                            if error.kind() == io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(5))
                        }
                        Err(error) => panic!("test listener failed: {error}"),
                    }
                };
                let mut stream = BufReader::new(DeadlineStream::new(stream, SOCKET_TIMEOUT));
                let request = head(&mut stream).unwrap();
                let mut slots = [httparse::EMPTY_HEADER; 48];
                let mut parsed = httparse::Request::new(&mut slots);
                assert!(parsed.parse(&request).unwrap().is_complete());
                assert_eq!(
                    parsed.path,
                    Some(HttpOperation::GetAppReadiness.descriptor().path)
                );
                let bearer = format!("Bearer {}", bootstrap.app_credential);
                assert!(header(parsed.headers, "authorization").unwrap() == Some(bearer.as_str()));
                assert!(header(parsed.headers, "accept-encoding").unwrap() == Some("identity"));
                assert!(
                    header(parsed.headers, "x-app-installation").unwrap()
                        == Some("candidate-smoke")
                );
                assert!(header(parsed.headers, "x-app-generation").unwrap() == Some("17"));
                let payload = json!({"ready": ready, "protocolVersion": "1.0.0", "providers": []});
                respond(
                    stream.get_mut(),
                    status,
                    &serde_json::to_vec(&payload).unwrap(),
                )
                .unwrap();
            }
        });
        let result = poll(
            &endpoint,
            &bootstrap,
            &protocol,
            HttpOperation::GetAppReadiness,
            deadline,
        )
        .unwrap();
        assert_eq!(result["ready"], true);
        server.join().unwrap();
    });
}

#[test]
fn absolute_deadline_stops_a_peer_that_keeps_dripping_bytes() {
    let (mut writer, reader) = UnixStream::pair().unwrap();
    let worker = thread::spawn(move || {
        for _ in 0..30 {
            if writer.write_all(b"x").is_err() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
    });
    let mut reader = DeadlineStream::new(reader, Duration::from_millis(60));
    assert!(reader.read_to_end(&mut Vec::new()).is_err());
    drop(reader);
    worker.join().unwrap();
}
