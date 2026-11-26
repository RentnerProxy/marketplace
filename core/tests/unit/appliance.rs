use super::*;

#[test]
fn appliance_forwards_only_allowlisted_application_settings() {
    let optional = [
        ("TRUST_PROXY_HEADERS", "true"),
        ("TRUSTED_PROXY_RANGES", "127.0.0.1/32,::1/128"),
        ("PASSKEY_ORIGIN", "https://example.test"),
        ("PASSKEY_RP_ID", "example.test"),
        ("PASSKEY_RP_NAME", "Example Application"),
        ("BACKUP_TIMEZONE", "Europe/Berlin"),
        ("BACKUP_POSTGRES_TIMEOUT_SECONDS", "3600"),
        ("DATABASE_POOL_MAX", "12"),
        ("DATABASE_POOL_IDLE_TIMEOUT_SECONDS", "35"),
        ("DATABASE_POOL_MAX_LIFETIME_SECONDS", "1800"),
        ("DATABASE_POOL_CONNECTION_TIMEOUT_SECONDS", "10"),
        ("CORE_STORAGE_FFI", "disabled"),
    ];
    let mut input: Environment = [
        ("POSTGRES_PASSWORD", "synthetic-password"),
        ("ORIGIN", "https://example.test"),
        (
            "AUTH_ENCRYPTION_KEY",
            "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
        ),
        ("SMTP_HOST", "smtp.example.test"),
        ("SMTP_USER", "mail@example.test"),
        ("SMTP_PASSWORD", "synthetic-mail"),
        ("CI", "true"),
        ("TEST", "true"),
    ]
    .into_iter()
    .chain(optional)
    .map(|(key, value)| (key.into(), value.into()))
    .collect();
    let application = create_environment(&input, false).unwrap();
    let maintenance = create_environment(&input, true).unwrap();
    let dependency = environment::service_environment(&application);
    for (key, value) in optional {
        assert_eq!(application[key], value);
        assert!(!maintenance.contains_key(key));
        assert!(!dependency.contains_key(key));
        for invalid in ["x".repeat(8193), "invalid\0value".into()] {
            input.insert(key.into(), invalid);
            assert!(create_environment(&input, false).is_err(), "{key}");
        }
        input.insert(key.into(), value.into());
    }
    assert!(!application.contains_key("CI"));
    assert!(!application.contains_key("TEST"));
}

#[test]
fn appliance_validates_container_identity_and_defaults_missing_values() {
    let input = Environment::from([("POSTGRES_PASSWORD".into(), "synthetic-password".into())]);
    let defaults = create_environment(&input, true).unwrap();
    assert_eq!(defaults["POSTGRES_DB"], "rentnerproxy_marketplace");
    assert_eq!(defaults["MAIL_FROM_NAME"], "RentnerProxy Marketplace");

    let mut renamed = input.clone();
    renamed.insert("POSTGRES_DB".into(), "example_app18".into());
    renamed.insert("MAIL_FROM_NAME".into(), "  Example App Österreich  ".into());
    let environment = create_environment(&renamed, true).unwrap();
    assert_eq!(environment["POSTGRES_DB"], "example_app18");
    assert_eq!(environment["MAIL_FROM_NAME"], "Example App Österreich");

    for value in [
        "",
        "1example",
        "Example",
        "example db",
        "example\0db",
        "exämple",
        "postgres",
        "template0",
        "template1",
        "pg_example",
        &"a".repeat(64),
    ] {
        let mut invalid = input.clone();
        invalid.insert("POSTGRES_DB".into(), value.into());
        assert_eq!(
            create_environment(&invalid, true).unwrap_err(),
            "appliance_configuration_invalid: POSTGRES_DB"
        );
    }
    for value in [
        "",
        "   ",
        "Example\r\nApp",
        "Example\0App",
        "Example\u{0085}App",
        "Example \"App\"",
        &"é".repeat(201),
        &"🙂".repeat(101),
    ] {
        let mut invalid = input.clone();
        invalid.insert("MAIL_FROM_NAME".into(), value.into());
        assert_eq!(
            create_environment(&invalid, true).unwrap_err(),
            "appliance_configuration_invalid: MAIL_FROM_NAME"
        );
    }
}

#[test]
fn native_driver_fails_closed_when_scrubbed_path_has_no_privilege_or_database_tools() {
    let directory = tempfile::tempdir().unwrap();
    let mut environment = create_environment(
        &[("POSTGRES_PASSWORD".into(), "synthetic-password".into())]
            .into_iter()
            .collect(),
        true,
    )
    .unwrap();
    environment.insert("PATH".into(), directory.path().to_str().unwrap().into());
    let stopping = AtomicBool::new(false);
    let mut driver = NativeDriver {
        environment: &environment,
        logs: Arc::new(LogStore::new(Vec::new())),
        stopping: &stopping,
        maintenance: true,
        children: Vec::new(),
    };
    assert!(driver.start(Role::Postgresql).is_err());
    assert!(!driver.probe(Role::Postgresql));
    assert!(!driver.any_exited());
    assert!(!driver.stop(true, Duration::from_millis(100)));
    assert!(!driver.stop(false, Duration::from_millis(100)));
    driver.finish();
}
