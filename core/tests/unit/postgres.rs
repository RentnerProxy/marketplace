use super::*;

#[test]
fn private_service_preserves_decoded_uri_options_query_precedence_and_ipv6() {
    let (url,password)=connection("postgresql://name%20with%20spaces:p%0Aass@[::1]:5433/db%2Fname?application_name=my%20app&options=-c%20search_path%3Dpublic&sslmode=require&user=override",None).unwrap();
    assert_eq!(password.as_deref(), Some("p\nass"));
    let settings = service_settings(&url).unwrap();
    for line in [
        "host=::1\n",
        "port=5433\n",
        "dbname=db/name\n",
        "user=override\n",
        "application_name=my app\n",
        "options=-c search_path=public\n",
        "sslmode=require\n",
    ] {
        assert!(settings.contains(line));
    }
    assert!(!settings.contains("password"));
    assert!(!settings.contains("p%0Aass"));
}

#[test]
fn private_service_preserves_unix_socket_urls_and_legacy_ssl_alias() {
    let (url, _) = connection(
        "postgresql:///database?host=%2Ftmp%2Fpostgresql&ssl=true",
        None,
    )
    .unwrap();
    let settings = service_settings(&url).unwrap();
    assert!(settings.contains("host=/tmp/postgresql\n"));
    assert!(settings.contains("dbname=database\n"));
    assert!(settings.contains("sslmode=require\n"));
    assert!(
        service_settings("postgresql:///database")
            .unwrap()
            .contains("dbname=database\n")
    );
}

#[test]
fn private_service_rejects_line_injection_and_unrepresentable_fields() {
    for url in [
        "postgresql://user%0Ahost%3Dattacker@localhost/db",
        "postgresql://localhost/db?application_name=unsafe%00value",
        "postgresql://localhost/db?application_name=trailing%20",
        "postgresql://localhost/db?service=nested",
        "postgresql://localhost/db?password=must-not-persist",
    ] {
        assert_eq!(
            service_settings(url).unwrap_err().code,
            "BACKUP_POSTGRES_CONFIG"
        );
    }
    assert!(
        service_settings(&format!(
            "postgresql://localhost/db?options={}",
            "x".repeat(1024)
        ))
        .is_err()
    );
}

#[test]
fn strict_percent_decoder_rejects_truncated_nonhex_and_invalid_utf8_values() {
    for value in ["%", "%0", "%ZZ", "%€", "%FF"] {
        assert!(decode(value).is_err());
    }
    assert!(service_settings("not-a-connection-url").is_err());
    assert_eq!(decode("a%2Bb+%C3%B6").unwrap(), "a+b+ö");
}

#[test]
fn bounded_process_output_is_fully_drained_and_reader_failures_are_secret_safe() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    struct Tracked {
        remaining: usize,
        consumed: Arc<AtomicUsize>,
    }
    impl Read for Tracked {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let count = self.remaining.min(buffer.len());
            buffer[..count].fill(b'x');
            self.remaining -= count;
            self.consumed.fetch_add(count, Ordering::SeqCst);
            Ok(count)
        }
    }
    let consumed = Arc::new(AtomicUsize::new(0));
    let output = joined_output(capture(Tracked {
        remaining: 100_000,
        consumed: consumed.clone(),
    }))
    .unwrap();
    assert_eq!(output.len(), 65536);
    assert_eq!(consumed.load(Ordering::SeqCst), 100_000);
    struct FailedReader;
    impl Read for FailedReader {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("synthetic-stream-secret"))
        }
    }
    let error = joined_output(capture(FailedReader)).unwrap_err();
    assert_eq!(error.code, "BACKUP_POSTGRES_COMMAND_FAILED");
    assert!(!error.message.contains("synthetic-stream-secret"));
    let error = joined_output(std::thread::spawn(|| panic!("synthetic-panic-secret"))).unwrap_err();
    assert!(!error.message.contains("synthetic-panic-secret"));
}
