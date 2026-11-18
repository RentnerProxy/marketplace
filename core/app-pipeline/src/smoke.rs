use marketplace_artifacts::invalid;
use rentnerproxy_app_contracts::{Contracts, ManifestEnvironment, ProtocolContracts};
use serde_json::{Value, json};
use std::io;

pub fn bootstrap(input: &Value) -> io::Result<Value> {
    let manifest = &input["manifest"];
    let target = manifest["target"]
        .as_str()
        .ok_or_else(|| invalid("Invalid app target"))?;
    let version = input["version"]
        .as_str()
        .ok_or_else(|| invalid("Invalid app contract version"))?;
    Contracts::new()
        .and_then(|contracts| {
            contracts.check_manifest_compatibility(
                manifest,
                &ManifestEnvironment {
                    target,
                    runtime_profile: "rentnerproxy-linux-v1",
                    platform_api: version,
                    app_protocol: version,
                    ui_bridge: Some(version),
                    engine_capabilities: &["caddy.load-balancing.v1", "caddy.crowdsec.v1"],
                },
            )
        })
        .map_err(|_| invalid("Candidate is incompatible with its smoke runtime"))?;
    let credential = || -> io::Result<String> {
        let mut secret = [0; 32];
        getrandom::fill(&mut secret).map_err(|_| invalid("Could not create smoke credential"))?;
        Ok(hex::encode(secret))
    };
    let mut versions = json!({"appProtocol": version, "platformApi": version});
    if !manifest["ui"].is_null() {
        versions["uiBridge"] = json!(version);
    }
    let descriptor = json!({
        "formatVersion": 1,
        "appId": manifest["id"],
        "installationId": "candidate-smoke",
        "generation": 1,
        "runtimeProfile": "rentnerproxy-linux-v1",
        "versions": versions,
        "appSocket": "/run-fixture/app/app.sock",
        "coreSocket": "/run-fixture/core/core.sock",
        "appCredential": credential()?,
        "coreCredential": credential()?,
    });
    ProtocolContracts::new()
        .and_then(|protocol| protocol.validate("BootstrapDescriptor", &descriptor))
        .map_err(|_| invalid("Invalid runtime bootstrap"))?;
    Ok(descriptor)
}

#[cfg(not(unix))]
pub fn probe(_: Value) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Candidate runtime probe requires Unix sockets",
    ))
}

#[cfg(any(unix, test))]
mod http {
    use marketplace_artifacts::{invalid, parse_json};
    use serde_json::Value;
    use std::io::{self, BufRead, Read};

    const HEADER_LIMIT: usize = 16 * 1024;
    const RESPONSE_LIMIT: usize = 1024 * 1024;

    pub(super) fn head(reader: &mut impl Read) -> io::Result<Vec<u8>> {
        let mut result = Vec::new();
        let mut byte = [0];
        while result.len() < HEADER_LIMIT {
            reader.read_exact(&mut byte)?;
            result.push(byte[0]);
            if result.ends_with(b"\r\n\r\n") {
                return Ok(result);
            }
        }
        Err(invalid("Runtime probe HTTP header exceeds its byte limit"))
    }

    pub(super) fn header<'a>(
        headers: &'a [httparse::Header<'a>],
        name: &str,
    ) -> io::Result<Option<&'a str>> {
        let mut matches = headers
            .iter()
            .filter(|header| header.name.eq_ignore_ascii_case(name));
        let value = matches
            .next()
            .map(|header| {
                std::str::from_utf8(header.value).map(|value| value.trim_matches([' ', '\t']))
            })
            .transpose()
            .map_err(|_| invalid("Invalid runtime probe HTTP header"))?;
        if matches.next().is_some() {
            return Err(invalid("Duplicate runtime probe HTTP header"));
        }
        Ok(value)
    }

    fn chunked(reader: &mut impl BufRead, limit: usize) -> io::Result<Vec<u8>> {
        let mut result = Vec::new();
        loop {
            let mut frame = Vec::new();
            (&mut *reader).take(129).read_until(b'\n', &mut frame)?;
            let count = std::str::from_utf8(&frame)
                .map_err(|_| invalid("Invalid chunked runtime response"))?;
            let count = count
                .strip_suffix("\r\n")
                .and_then(|count| count.split(';').next())
                .filter(|count| {
                    !count.is_empty() && count.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                .and_then(|count| usize::from_str_radix(count, 16).ok())
                .ok_or_else(|| invalid("Invalid chunked runtime response"))?;
            if count == 0 {
                consume_trailers(reader)?;
                return Ok(result);
            }
            let offset = result.len();
            let end = offset
                .checked_add(count)
                .filter(|size| *size <= limit)
                .ok_or_else(body_limit)?;
            result.resize(end, 0);
            reader.read_exact(&mut result[offset..])?;
            let mut delimiter = [0; 2];
            reader.read_exact(&mut delimiter)?;
            if delimiter != *b"\r\n" {
                return Err(invalid("Invalid chunked runtime response"));
            }
        }
    }

    fn consume_trailers(reader: &mut impl BufRead) -> io::Result<()> {
        let mut trailers = Vec::new();
        loop {
            let length = (&mut *reader)
                .take((HEADER_LIMIT - trailers.len()) as u64)
                .read_until(b'\n', &mut trailers)?;
            if length < 2 || !trailers.ends_with(b"\r\n") {
                return Err(invalid("Invalid chunked runtime trailers"));
            }
            if length == 2 {
                break;
            }
        }
        let mut slots = [httparse::EMPTY_HEADER; 48];
        let parsed = httparse::parse_headers(&trailers, &mut slots)
            .map_err(|_| invalid("Invalid chunked runtime trailers"))?;
        if !parsed.is_complete() {
            return Err(invalid("Invalid chunked runtime trailers"));
        }
        Ok(())
    }

    pub(super) enum Framing {
        Chunked,
        Length(usize),
        CloseDelimited,
    }

    pub(super) fn body_framing(
        headers: &[httparse::Header<'_>],
        allow_close_delimited: bool,
    ) -> io::Result<Framing> {
        let length = header(headers, "content-length")?;
        if let Some(encoding) = header(headers, "transfer-encoding")? {
            if length.is_some() || !encoding.eq_ignore_ascii_case("chunked") {
                return Err(invalid("Invalid runtime HTTP framing"));
            }
            return Ok(Framing::Chunked);
        }
        if let Some(length) = length {
            if length.is_empty() || !length.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(invalid("Invalid runtime HTTP content length"));
            }
            return length
                .parse::<usize>()
                .map(Framing::Length)
                .map_err(|_| invalid("Invalid runtime HTTP content length"));
        }
        Ok(if allow_close_delimited {
            Framing::CloseDelimited
        } else {
            Framing::Length(0)
        })
    }

    fn body_limit() -> io::Error {
        io::Error::new(
            io::ErrorKind::FileTooLarge,
            "Runtime HTTP body exceeds its byte limit",
        )
    }

    pub(super) fn framed_body(
        reader: &mut impl BufRead,
        framing: Framing,
        limit: usize,
    ) -> io::Result<Vec<u8>> {
        match framing {
            Framing::Chunked => chunked(reader, limit),
            Framing::Length(length) => {
                if length > limit {
                    return Err(body_limit());
                }
                let mut result = vec![0; length];
                reader.read_exact(&mut result)?;
                Ok(result)
            }
            Framing::CloseDelimited => {
                let mut result = Vec::new();
                reader.take(limit as u64 + 1).read_to_end(&mut result)?;
                if result.len() > limit {
                    return Err(body_limit());
                }
                Ok(result)
            }
        }
    }

    fn read_body(
        reader: &mut impl BufRead,
        headers: &[httparse::Header<'_>],
    ) -> io::Result<Vec<u8>> {
        let media = header(headers, "content-type")?.and_then(|value| value.split(';').next());
        if !media.is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json")) {
            return Err(invalid("App did not return JSON"));
        }
        if header(headers, "content-encoding")?
            .is_some_and(|encoding| !encoding.eq_ignore_ascii_case("identity"))
        {
            return Err(invalid("App did not return an identity-encoded response"));
        }
        framed_body(reader, body_framing(headers, true)?, RESPONSE_LIMIT)
    }

    pub(super) fn read_response(reader: &mut impl BufRead) -> io::Result<(u16, Value)> {
        for _ in 0..5 {
            let bytes = head(reader)?;
            let mut slots = [httparse::EMPTY_HEADER; 48];
            let mut response = httparse::Response::new(&mut slots);
            if !response
                .parse(&bytes)
                .map_err(|_| invalid("Invalid app response"))?
                .is_complete()
            {
                return Err(invalid("Incomplete app response"));
            }
            let status = response
                .code
                .ok_or_else(|| invalid("Missing app response status"))?;
            if status == 101 {
                return Err(invalid("Unexpected runtime protocol upgrade"));
            }
            if (100..200).contains(&status) {
                continue;
            }
            let body = parse_json(&read_body(reader, response.headers)?)?;
            return Ok((status, body));
        }
        Err(invalid("Too many informational app responses"))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use serde_json::json;
        use std::io::Cursor;

        fn response(frame: &str) -> io::Result<(u16, Value)> {
            let wire = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{frame}");
            read_response(&mut Cursor::new(wire))
        }

        #[test]
        fn accepts_fixed_chunked_and_close_delimited_json() {
            for frame in [
                "Content-Length: 2\r\n\r\n{}",
                "Transfer-Encoding: chunked\r\n\r\n1;extension=value\r\n{\r\n1\r\n}\r\n0\r\nX-Trailer: value\r\n\r\n",
                "Connection: close\r\n\r\n{}",
            ] {
                assert_eq!(response(frame).unwrap(), (200, json!({})));
            }
            let hints = b"HTTP/1.1 103 Early Hints\r\nLink: </example>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}";
            assert_eq!(
                read_response(&mut Cursor::new(hints)).unwrap(),
                (200, json!({}))
            );
        }

        #[test]
        fn rejects_ambiguous_incomplete_and_oversized_http_responses() {
            for frame in [
                "Content-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
                "Content-Length: 2\r\ncontent-length: 2\r\n\r\n{}",
                "Content-Length: +2\r\n\r\n{}",
                "Content-Length: 3\r\n\r\n{}",
                "Content-Length: 1048577\r\n\r\n",
                "Transfer-Encoding: chunked\r\n\r\n+2\r\n{}\r\n0\r\n\r\n",
                "Transfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n",
                "Transfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\nX-Trailer: value\r\n",
                "Transfer-Encoding: chunked\r\n\r\n100001\r\n",
                "Content-Encoding: gzip\r\n\r\n{}",
                "\r\n{\"healthy\":true,\"healthy\":false}",
            ] {
                assert!(response(frame).is_err(), "accepted frame {frame:?}");
            }
            let oversized = format!("X-Long: {}\r\n\r\n{{}}", "x".repeat(HEADER_LIMIT));
            assert!(response(&oversized).is_err());
        }
    }
}

#[cfg(unix)]
mod unix {
    use super::http::{Framing, body_framing, framed_body, head, header, read_response};
    use marketplace_artifacts::{invalid, parse_json, read_file};
    use rentnerproxy_app_contracts::{Contracts, HttpOperation, ProtocolContracts};
    use serde::Deserialize;
    use serde_json::{Value, json};
    use std::collections::HashSet;
    use std::fs;
    use std::io::{self, BufReader, Read, Write};
    use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread;
    use std::time::{Duration, Instant};

    const APP_SOCKET: &str = "/run-fixture/app/app.sock";
    const CORE_SOCKET: &str = "/run-fixture/core/core.sock";
    const CONTEXT_REQUEST_LIMIT: usize = 4096;
    const MANIFEST_LIMIT: u64 = 4 * 1024 * 1024;
    const SOCKET_TIMEOUT: Duration = Duration::from_secs(1);

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Bootstrap {
        app_id: String,
        installation_id: String,
        generation: u64,
        runtime_profile: String,
        versions: Value,
        app_socket: String,
        core_socket: String,
        app_credential: String,
        core_credential: String,
    }

    struct DeadlineStream {
        stream: UnixStream,
        deadline: Instant,
    }

    impl DeadlineStream {
        fn new(stream: UnixStream, duration: Duration) -> Self {
            Self {
                stream,
                deadline: Instant::now() + duration,
            }
        }

        fn remaining(&self) -> io::Result<Duration> {
            self.deadline
                .checked_duration_since(Instant::now())
                .filter(|remaining| !remaining.is_zero())
                .map(|remaining| remaining.max(Duration::from_micros(1)))
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::TimedOut,
                        "Runtime probe HTTP deadline elapsed",
                    )
                })
        }
    }

    impl Read for DeadlineStream {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            self.stream.set_read_timeout(Some(self.remaining()?))?;
            self.stream.read(buffer)
        }
    }

    impl Write for DeadlineStream {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.stream.set_write_timeout(Some(self.remaining()?))?;
            self.stream.write(buffer)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.stream.flush()
        }
    }

    fn respond(stream: &mut impl Write, status: &str, bytes: &[u8]) -> io::Result<()> {
        write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            bytes.len()
        )?;
        stream.write_all(bytes)
    }

    fn context_request(
        stream: UnixStream,
        bootstrap: &Bootstrap,
        context: &[u8],
    ) -> io::Result<()> {
        let mut reader = BufReader::new(DeadlineStream::new(stream, SOCKET_TIMEOUT));
        let bytes = head(&mut reader)?;
        let mut slots = [httparse::EMPTY_HEADER; 48];
        let mut request = httparse::Request::new(&mut slots);
        if !request
            .parse(&bytes)
            .map_err(|_| invalid("Invalid runtime context request"))?
            .is_complete()
        {
            return Err(invalid("Incomplete runtime context request"));
        }
        let framing = match body_framing(request.headers, false) {
            Ok(framing) => framing,
            Err(_) => return respond(reader.get_mut(), "400 Bad Request", b""),
        };
        if matches!(framing, Framing::Length(length) if length > CONTEXT_REQUEST_LIMIT) {
            return respond(reader.get_mut(), "413 Payload Too Large", b"");
        }
        let path = HttpOperation::GetPlatformContext.descriptor().path;
        if request.method != Some("GET")
            || request.path.and_then(|path| path.split('?').next()) != Some(path)
        {
            return respond(reader.get_mut(), "404 Not Found", b"");
        }
        let token = format!("Bearer {}", bootstrap.core_credential);
        let generation = bootstrap.generation.to_string();
        let authenticated = [
            ("authorization", token.as_str()),
            ("x-app-installation", bootstrap.installation_id.as_str()),
            ("x-app-generation", generation.as_str()),
        ]
        .iter()
        .all(|(name, expected)| {
            header(request.headers, name).is_ok_and(|actual| actual == Some(*expected))
        });
        if !authenticated {
            return respond(reader.get_mut(), "403 Forbidden", b"");
        }
        if let Err(error) = framed_body(&mut reader, framing, CONTEXT_REQUEST_LIMIT) {
            let status = if error.kind() == io::ErrorKind::FileTooLarge {
                "413 Payload Too Large"
            } else {
                "400 Bad Request"
            };
            return respond(reader.get_mut(), status, b"");
        }
        respond(reader.get_mut(), "200 OK", context)
    }

    struct AppEndpoint<'a> {
        path: &'a Path,
        uid: u32,
    }

    impl AppEndpoint<'_> {
        fn connect(&self) -> io::Result<UnixStream> {
            let metadata = fs::symlink_metadata(self.path)?;
            if !metadata.file_type().is_socket() || metadata.uid() != self.uid {
                return Err(invalid("App socket has unexpected ownership"));
            }
            connect(self.path, self.uid)
        }
    }

    #[cfg(target_os = "linux")]
    fn connect(path: &Path, uid: u32) -> io::Result<UnixStream> {
        use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
        use std::os::unix::ffi::OsStrExt;

        // SAFETY: sockaddr_un contains only integer fields and the path buffer.
        let mut address: libc::sockaddr_un = unsafe { std::mem::zeroed() };
        let path = path.as_os_str().as_bytes();
        if path.is_empty() || path.contains(&0) || path.len() >= address.sun_path.len() {
            return Err(invalid("Invalid app socket address"));
        }
        address.sun_family = libc::AF_UNIX as libc::sa_family_t;
        for (slot, &byte) in address.sun_path.iter_mut().zip(path) {
            *slot = byte as libc::c_char;
        }
        let length = std::mem::offset_of!(libc::sockaddr_un, sun_path) + path.len() + 1;

        // SAFETY: The arguments select a new nonblocking Unix stream socket.
        let fd = unsafe {
            libc::socket(
                libc::AF_UNIX,
                libc::SOCK_STREAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
                0,
            )
        };
        if fd == -1 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: socket returned a new live descriptor, and ownership is transferred exactly once.
        let fd = unsafe { OwnedFd::from_raw_fd(fd) };
        // SAFETY: The live descriptor and initialized address cover the exact address length.
        if unsafe {
            libc::connect(
                fd.as_raw_fd(),
                std::ptr::from_ref(&address).cast(),
                length as libc::socklen_t,
            )
        } == -1
        {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: ucred contains only integer fields and is filled by getsockopt.
        let mut peer: libc::ucred = unsafe { std::mem::zeroed() };
        let mut size = std::mem::size_of_val(&peer) as libc::socklen_t;
        // SAFETY: The SO_PEERCRED output buffer points to a live ucred and its exact writable length.
        if unsafe {
            libc::getsockopt(
                fd.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                std::ptr::from_mut(&mut peer).cast(),
                &mut size,
            )
        } == -1
        {
            return Err(io::Error::last_os_error());
        }
        if usize::try_from(size).ok() != Some(std::mem::size_of_val(&peer)) || peer.uid != uid {
            return Err(invalid("App socket has unexpected ownership"));
        }
        let stream = UnixStream::from(fd);
        stream.set_nonblocking(false)?;
        Ok(stream)
    }

    #[cfg(not(target_os = "linux"))]
    fn connect(path: &Path, _uid: u32) -> io::Result<UnixStream> {
        UnixStream::connect(path)
    }

    fn fetch(
        endpoint: &AppEndpoint<'_>,
        bootstrap: &Bootstrap,
        operation: HttpOperation,
        timeout: Duration,
    ) -> io::Result<(u16, Value)> {
        let mut stream = DeadlineStream::new(endpoint.connect()?, timeout);
        write!(
            stream,
            "GET {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAccept-Encoding: identity\r\nAuthorization: Bearer {}\r\nX-App-Installation: {}\r\nX-App-Generation: {}\r\n\r\n",
            operation.descriptor().path,
            bootstrap.app_credential,
            bootstrap.installation_id,
            bootstrap.generation,
        )?;
        read_response(&mut BufReader::new(stream))
    }

    fn poll(
        endpoint: &AppEndpoint<'_>,
        bootstrap: &Bootstrap,
        contracts: &ProtocolContracts,
        operation: HttpOperation,
        end: Instant,
    ) -> io::Result<Value> {
        while let Some(remaining) = end.checked_duration_since(Instant::now()) {
            if !remaining.is_zero()
                && let Ok((status, data)) = fetch(
                    endpoint,
                    bootstrap,
                    operation,
                    remaining.min(SOCKET_TIMEOUT),
                )
                && status == operation.descriptor().success_status
                && contracts
                    .validate_http_response(operation, status, Some(&data))
                    .is_ok()
            {
                return Ok(data);
            }
            thread::sleep(
                end.saturating_duration_since(Instant::now())
                    .min(Duration::from_millis(100)),
            );
        }
        Err(invalid(format!(
            "App did not pass the v1 {} probe",
            operation.id()
        )))
    }

    pub(super) fn probe(value: Value) -> io::Result<()> {
        let protocol =
            ProtocolContracts::new().map_err(|_| invalid("Runtime protocol is unavailable"))?;
        protocol
            .validate("BootstrapDescriptor", &value)
            .map_err(|_| invalid("Invalid runtime bootstrap"))?;
        let bootstrap: Bootstrap = serde_json::from_value(value)?;
        if bootstrap.app_socket != APP_SOCKET || bootstrap.core_socket != CORE_SOCKET {
            return Err(invalid("Invalid runtime fixture sockets"));
        }
        let manifest = parse_json(&read_file(Path::new("/package/app.json"), MANIFEST_LIMIT)?)?;
        Contracts::new()
            .and_then(|contract| contract.validate_manifest(&manifest))
            .map_err(|_| invalid("Invalid runtime package manifest"))?;
        let context = json!({
            "appId": bootstrap.app_id, "installationId": bootstrap.installation_id,
            "generation": bootstrap.generation, "runtimeProfile": bootstrap.runtime_profile,
            "versions": bootstrap.versions, "capabilities": manifest["capabilities"],
        });
        protocol
            .validate("PlatformContext", &context)
            .map_err(|_| invalid("Invalid runtime fixture context"))?;
        let context = serde_json::to_vec(&context)?;
        fs::DirBuilder::new()
            .mode(0o770)
            .create("/run-fixture/core")?;
        let listener = UnixListener::bind(CORE_SOCKET)?;
        fs::set_permissions(CORE_SOCKET, fs::Permissions::from_mode(0o660))?;
        listener.set_nonblocking(true)?;
        let stop = AtomicBool::new(false);
        thread::scope(|scope| {
            scope.spawn(|| {
                while !stop.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let _ = context_request(stream, &bootstrap, &context);
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(_) => break,
                    }
                }
            });
            let result = (|| {
                let timeout = manifest["resources"]["startupTimeoutMs"]
                    .as_u64()
                    .ok_or_else(|| invalid("Missing runtime probe deadline"))?;
                let end = Instant::now() + Duration::from_millis(timeout);
                let endpoint = AppEndpoint {
                    path: Path::new(APP_SOCKET),
                    uid: 21001,
                };
                poll(
                    &endpoint,
                    &bootstrap,
                    &protocol,
                    HttpOperation::GetAppHealth,
                    end,
                )?;
                let ready = poll(
                    &endpoint,
                    &bootstrap,
                    &protocol,
                    HttpOperation::GetAppReadiness,
                    end,
                )?;
                if ready["dataVersion"] != manifest["data"]["targetVersion"] {
                    return Err(invalid(
                        "App readiness disagrees with the declared data version",
                    ));
                }
                let expected = manifest["providers"]
                    .as_array()
                    .expect("validated app manifest");
                let actual: HashSet<_> = ready["providers"]
                    .as_array()
                    .expect("validated readiness")
                    .iter()
                    .filter_map(|provider| provider["profile"].as_str())
                    .collect();
                if expected.len() != actual.len()
                    || expected.iter().any(|profile| {
                        !profile
                            .as_str()
                            .is_some_and(|profile| actual.contains(profile))
                    })
                {
                    return Err(invalid(
                        "App readiness disagrees with the declared provider profiles",
                    ));
                }
                Ok(())
            })();
            stop.store(true, Ordering::Release);
            result
        })
    }

    #[cfg(test)]
    mod tests {
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
                let server =
                    scope.spawn(|| context_request(server, bootstrap, b"{\"context\":true}"));
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
            assert!(
                core_response(&bootstrap, "GET", core, 16, "\r\n").starts_with("HTTP/1.1 403 ")
            );
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
            assert!(
                core_response(&bootstrap, "POST", core, 17, "\r\n").starts_with("HTTP/1.1 404 ")
            );
        }

        #[test]
        fn core_context_applies_the_request_body_limit_before_serving() {
            let bootstrap = fixture();
            let core = &bootstrap.core_credential;
            for body in [
                "Content-Length: 2\r\n\r\n{}",
                "Transfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
            ] {
                assert!(
                    core_response(&bootstrap, "GET", core, 17, body).starts_with("HTTP/1.1 200 ")
                );
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
            let directory = tempfile::tempdir().unwrap();
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
                        let mut stream =
                            BufReader::new(DeadlineStream::new(stream, SOCKET_TIMEOUT));
                        let request = head(&mut stream).unwrap();
                        let mut slots = [httparse::EMPTY_HEADER; 48];
                        let mut parsed = httparse::Request::new(&mut slots);
                        assert!(parsed.parse(&request).unwrap().is_complete());
                        assert_eq!(
                            parsed.path,
                            Some(HttpOperation::GetAppReadiness.descriptor().path)
                        );
                        let bearer = format!("Bearer {}", bootstrap.app_credential);
                        assert!(
                            header(parsed.headers, "authorization").unwrap()
                                == Some(bearer.as_str())
                        );
                        assert!(
                            header(parsed.headers, "accept-encoding").unwrap() == Some("identity")
                        );
                        assert!(
                            header(parsed.headers, "x-app-installation").unwrap()
                                == Some("candidate-smoke")
                        );
                        assert!(header(parsed.headers, "x-app-generation").unwrap() == Some("17"));
                        let payload =
                            json!({"ready": ready, "protocolVersion": "1.0.0", "providers": []});
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
    }
}

#[cfg(unix)]
pub fn probe(value: Value) -> io::Result<()> {
    unix::probe(value)
}
