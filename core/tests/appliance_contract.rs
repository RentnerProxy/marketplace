use marketplace_core::appliance::{create_environment, redact_line};
use std::collections::BTreeMap;

#[test]
fn scrubbed_environment_cannot_inherit_runtime_injection_or_other_credentials() {
    let input = BTreeMap::from([
        (
            "POSTGRES_PASSWORD".into(),
            "synthetic $ ; \" ä secret".into(),
        ),
        ("PATH".into(), "/untrusted".into()),
        ("NODE_OPTIONS".into(), "--require=bad".into()),
        ("BUN_OPTIONS".into(), "--preload=bad".into()),
        ("UNRELATED_SECRET".into(), "secret".into()),
        (
            "MARKETPLACE_CANDIDATE_GITHUB_TOKEN".into(),
            "synthetic-actions-token".into(),
        ),
    ]);
    let env = create_environment(&input, true).unwrap();
    assert_eq!(env["POSTGRES_PASSWORD"], input["POSTGRES_PASSWORD"]);
    assert_eq!(env["POSTGRES_HOST"], "127.0.0.1");
    assert!(!env.contains_key("NODE_OPTIONS"));
    assert!(!env.contains_key("BUN_OPTIONS"));
    assert!(!env.contains_key("UNRELATED_SECRET"));
    assert!(!env.contains_key("MARKETPLACE_CANDIDATE_GITHUB_TOKEN"));
    assert_ne!(env["PATH"], input["PATH"]);
    assert!(create_environment(&input, false).is_err());
    assert!(
        !format!("{:?}", create_environment(&BTreeMap::new(), true).err()).contains("synthetic")
    );
}

#[test]
fn log_redaction_preserves_umlauts_and_covers_native_database_output() {
    for message in [
        "http://localhost/setup#access=synthetic-secret",
        "postgresql://user:synthetic-secret@db/app",
        r#"{"password":"synthetic-secret","event":"app.ready"}"#,
        "AUTH_ENCRYPTION_KEY=synthetic-secret",
        "Authorization: Bearer synthetic-secret",
        "DETAIL: Key (email)=(synthetic-secret) already exists.",
        "STATEMENT: SELECT synthetic-secret",
        "CONTEXT: PL/pgSQL function synthetic-secret",
        "QUERY: SELECT synthetic-secret",
    ] {
        let redacted = redact_line(message);
        assert!(!redacted.contains("synthetic-secret"), "{redacted}");
        assert!(redacted.contains("[REDACTED]"));
    }
    assert_eq!(redact_line("\x1b[31mÜberprüfung\x1b[0m"), "Überprüfung");
    assert_eq!(redact_line(&"ä".repeat(10000)).chars().count(), 4097);
    let astral = redact_line(&"🦀".repeat(3000));
    assert_eq!(astral.encode_utf16().count(), 4097);
}

#[test]
fn lightweight_log_redaction_preserves_unicode_spacing_and_case_folds() {
    for (line, expected) in [
        ("Bearer\u{a0}synthetic-secret", "Bearer\u{a0}[REDACTED]"),
        (
            "token=synthetic-secret\u{2003}Überprüfung",
            "token=[REDACTED]\u{2003}Überprüfung",
        ),
        ("ſecret=synthetic-secret", "ſecret=[REDACTED]"),
        ("?toKen=synthetic-secret", "?toKen=[REDACTED]"),
        (
            "\"paſſword\"\u{2003}:\u{2003}\"synthetic-secret\"",
            "\"paſſword\"\u{2003}:\u{2003}\"[REDACTED]\"",
        ),
        ("eyJabc.signed.lastſ", "[REDACTED]"),
        (
            "http://user:p@localhost/path",
            "http://[REDACTED]@localhost/path",
        ),
    ] {
        assert_eq!(redact_line(line), expected, "{line}");
    }
}

fn production_environment() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("POSTGRES_PASSWORD".into(), "synthetic-password".into()),
        ("ORIGIN".into(), "https://example.test".into()),
        (
            "AUTH_ENCRYPTION_KEY".into(),
            "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=".into(),
        ),
        ("SMTP_HOST".into(), "smtp.example.test".into()),
        ("SMTP_USER".into(), "mail@example.test".into()),
        ("SMTP_PASSWORD".into(), "synthetic-mail".into()),
    ])
}

#[test]
fn candidate_app_settings_reach_only_the_application_environment() {
    let mut input = production_environment();
    let app = [
        ("MARKETPLACE_CANDIDATE_GITHUB_APP_CLIENT_ID", "Iv1.fixture"),
        ("MARKETPLACE_CANDIDATE_GITHUB_APP_INSTALLATION_ID", "123"),
        (
            "MARKETPLACE_CANDIDATE_GITHUB_APP_PRIVATE_KEY_FILE",
            "/run/secrets/candidate-app.pem",
        ),
    ];
    input.extend(app.map(|(key, value)| (key.into(), value.into())));
    input.insert(
        "MARKETPLACE_CANDIDATE_GITHUB_APP_PEM".into(),
        "private fixture".into(),
    );
    let application = create_environment(&input, false).unwrap();
    let maintenance = create_environment(&input, true).unwrap();
    for (key, value) in app {
        assert_eq!(application[key], value);
        assert!(!maintenance.contains_key(key));
    }
    assert!(!application.contains_key("MARKETPLACE_CANDIDATE_GITHUB_APP_PEM"));
}

#[test]
fn email_validation_preserves_the_previous_local_domain_and_dot_rules() {
    let mut env = production_environment();
    for email in ["a@example.test", " a@x.y ", "a+b@local..", "a@...", "ä@ö.ü"] {
        env.insert("MAIL_FROM".into(), email.into());
        assert!(create_environment(&env, false).is_ok(), "{email}");
    }
    for email in [
        "a@example",
        "a@.com",
        "a@com.",
        "@a.b",
        "a@@a.b",
        "a@..",
        "a@x\u{a0}.y",
        "a b@x.y",
    ] {
        env.insert("MAIL_FROM".into(), email.into());
        assert_eq!(
            create_environment(&env, false).unwrap_err(),
            "appliance_configuration_invalid: MAIL_FROM",
            "{email}"
        );
    }
}

#[test]
fn production_environment_rejects_invalid_credentials_transport_and_mail_before_startup() {
    let mut env = production_environment();
    env.insert(
        "MARKETPLACE_CANDIDATE_GITHUB_TOKEN".into(),
        "synthetic-actions-token".into(),
    );
    let parsed = create_environment(&env, false).unwrap();
    assert_eq!(parsed["MAIL_FROM"], "mail@example.test");
    assert_eq!(
        parsed["MARKETPLACE_CANDIDATE_GITHUB_TOKEN"],
        "synthetic-actions-token"
    );
    for (key, value) in [
        ("POSTGRES_USER", ""),
        ("POSTGRES_USER", "bad\0user"),
        ("POSTGRES_PASSWORD", ""),
        ("POSTGRES_PASSWORD", "CHANGE_ME"),
        ("POSTGRES_PASSWORD", "bad\npassword"),
        ("ORIGIN", "https://user:secret@example.test"),
        ("ORIGIN", "https://example.test/path"),
        ("ORIGIN", "http://example.test"),
        ("ORIGIN", "invalid"),
        ("AUTH_ENCRYPTION_KEY", "invalid"),
        ("SMTP_PORT", "0"),
        ("SMTP_PORT", "65536"),
        ("SMTP_SECURE", "maybe"),
        ("MAIL_FROM", "invalid"),
        ("SMTP_HOST", ""),
    ] {
        let mut invalid = env.clone();
        invalid.insert(key.into(), value.into());
        let result = create_environment(&invalid, false);
        assert!(result.is_err(), "accepted invalid {key}");
        assert!(!result.err().unwrap().contains("synthetic-password"));
    }
    let mut valid = env.clone();
    for (key, value) in [
        ("ORIGIN", "http://127.0.0.1:3000"),
        ("SMTP_PORT", "2525"),
        ("SMTP_SECURE", "true"),
        ("MAIL_FROM", ""),
        ("VITE_APP_VERSION", "1.2.3"),
    ] {
        valid.insert(key.into(), value.into());
    }
    assert!(create_environment(&valid, false).is_ok());
    for origin in [
        "http://127.0.0.2:3000",
        "http://[::1]:3000",
        "http://[::ffff:7f00:1]:3000",
    ] {
        valid.insert("ORIGIN".into(), origin.into());
        assert!(create_environment(&valid, false).is_ok(), "{origin}");
    }
    valid.insert("SMTP_HOST".into(), "x".repeat(8193));
    assert!(create_environment(&valid, false).is_err());
    valid.insert("SMTP_HOST".into(), "smtp\0example.test".into());
    assert!(create_environment(&valid, false).is_err());
}

#[cfg(unix)]
#[test]
fn privileged_directory_walk_rejects_symlink_components() {
    use marketplace_core::appliance::assert_directory;
    use std::{fs, os::unix::fs::symlink};
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("real")).unwrap();
    symlink(temp.path().join("real"), temp.path().join("link")).unwrap();
    assert!(assert_directory(&temp.path().join("real")).is_ok());
    assert!(assert_directory(&temp.path().join("link")).is_err());
    fs::create_dir(temp.path().join("real/child")).unwrap();
    assert!(assert_directory(&temp.path().join("link/child")).is_err());
}
