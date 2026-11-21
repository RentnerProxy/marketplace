use super::Result;
use base64::{Engine, engine::general_purpose::STANDARD};
use std::collections::BTreeMap;

pub type Environment = BTreeMap<String, String>;
const APPLICATION_KEYS: &[&str] = &[
    "ORIGIN",
    "AUTH_ENCRYPTION_KEY",
    "MARKETPLACE_CANDIDATE_GITHUB_APP_CLIENT_ID",
    "MARKETPLACE_CANDIDATE_GITHUB_APP_INSTALLATION_ID",
    "MARKETPLACE_CANDIDATE_GITHUB_APP_PRIVATE_KEY_FILE",
    "MARKETPLACE_CANDIDATE_GITHUB_TOKEN",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "MAIL_FROM",
    "VITE_APP_VERSION",
    "VITE_REALTIME_WS_URL",
];

pub(super) fn load_environment(maintenance: bool) -> Result<Environment> {
    let mut input = Environment::new();
    for key in ["POSTGRES_USER", "POSTGRES_PASSWORD"]
        .into_iter()
        .chain(APPLICATION_KEYS.iter().copied())
    {
        match std::env::var(key) {
            Ok(value) => {
                input.insert(key.into(), value);
            }
            Err(std::env::VarError::NotPresent) => (),
            Err(_) => return Err("appliance_configuration_invalid: non-UTF-8 setting"),
        }
    }
    create_environment(&input, maintenance)
}

/// Build an explicit child environment. Parent credentials and runtime injection flags never leak.
pub fn create_environment(input: &Environment, maintenance: bool) -> Result<Environment> {
    let user = input
        .get("POSTGRES_USER")
        .map(String::as_str)
        .unwrap_or("postgres");
    let password = input
        .get("POSTGRES_PASSWORD")
        .ok_or("appliance_configuration_invalid: POSTGRES_PASSWORD")?;
    if user.is_empty() || user.len() > 63 || user.contains(['\0', '\r', '\n']) {
        return Err("appliance_configuration_invalid: POSTGRES_USER");
    }
    if password.is_empty() || password == "CHANGE_ME" || password.contains(['\0', '\r', '\n']) {
        return Err("appliance_configuration_invalid: POSTGRES_PASSWORD");
    }
    let mut env: Environment = [
        (
            "PATH",
            "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        ),
        ("LANG", "C.UTF-8"),
        ("NODE_ENV", "production"),
        ("BUN_RUNTIME_TRANSPILER_CACHE_PATH", "0"),
        ("BUN_INSTALL_AUTO", "disable"),
        ("PORT", "3000"),
        ("INTERNAL_APP_PORT", "3002"),
        ("HOST", "0.0.0.0"),
        ("POSTGRES_HOST", "127.0.0.1"),
        ("POSTGRES_PORT", "5432"),
        ("POSTGRES_DB", "rentnerproxy_marketplace"),
        ("POSTGRES_USER", user),
        ("POSTGRES_PASSWORD", password),
        ("VALKEY_PASSWORD", password),
        ("VALKEY_URL", "redis://127.0.0.1:6379"),
        ("APP_STORAGE_DIR", "/data/storage/public"),
        ("APP_PRIVATE_STORAGE_DIR", "/data/storage/private"),
        ("BACKUP_DIR", "/data/backups"),
        ("MAIL_FROM_NAME", "TanStack Dummy"),
        ("CONTAINER_LOG_READER_URL", "http://127.0.0.1:3004"),
        ("CORE_ORIGIN", "http://127.0.0.1:3004"),
    ]
    .into_iter()
    .map(|(key, value)| (key.into(), value.into()))
    .collect();
    if maintenance {
        return Ok(env);
    }
    for &key in APPLICATION_KEYS {
        if let Some(value) = input.get(key) {
            if value.len() > 8192 || value.contains('\0') {
                return Err("appliance_configuration_invalid");
            }
            env.insert(key.into(), value.clone());
        }
    }
    if env
        .get("MAIL_FROM")
        .is_none_or(|value| value.trim().is_empty())
    {
        env.insert(
            "MAIL_FROM".into(),
            env.get("SMTP_USER").cloned().unwrap_or_default(),
        );
    }
    for key in [
        "ORIGIN",
        "AUTH_ENCRYPTION_KEY",
        "SMTP_HOST",
        "SMTP_USER",
        "SMTP_PASSWORD",
        "MAIL_FROM",
    ] {
        if env.get(key).is_none_or(|value| value.trim().is_empty()) {
            return Err("appliance_configuration_invalid: required application setting");
        }
    }
    let origin = url::Url::parse(env["ORIGIN"].trim())
        .map_err(|_| "appliance_configuration_invalid: ORIGIN")?;
    let loopback = match origin.host() {
        Some(url::Host::Domain("localhost")) => true,
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => {
            address.is_loopback()
                || address
                    .to_ipv4_mapped()
                    .is_some_and(|address| address.is_loopback())
        }
        _ => false,
    };
    if origin.origin().ascii_serialization() != env["ORIGIN"].trim()
        || !origin.username().is_empty()
        || origin.password().is_some()
        || !(origin.scheme() == "https" || origin.scheme() == "http" && loopback)
    {
        return Err("appliance_configuration_invalid: ORIGIN");
    }
    let key = env["AUTH_ENCRYPTION_KEY"].trim();
    if !STANDARD
        .decode(key)
        .is_ok_and(|bytes| bytes.len() == 32 && STANDARD.encode(bytes) == key)
    {
        return Err("appliance_configuration_invalid: AUTH_ENCRYPTION_KEY");
    }
    if let Some(port) = env
        .get("SMTP_PORT")
        .filter(|value| !value.trim().is_empty())
        && port
            .trim()
            .parse::<u16>()
            .ok()
            .filter(|port| *port > 0)
            .is_none()
    {
        return Err("appliance_configuration_invalid: SMTP_PORT");
    }
    if env
        .get("SMTP_SECURE")
        .is_some_and(|value| !value.trim().is_empty() && !matches!(value.trim(), "true" | "false"))
    {
        return Err("appliance_configuration_invalid: SMTP_SECURE");
    }
    let email = regex::Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").expect("static mail expression");
    if !email.is_match(env["MAIL_FROM"].trim()) {
        return Err("appliance_configuration_invalid: MAIL_FROM");
    }
    // Full application and realtime/passkey validation remains owned by TypeScript entrypoints.
    Ok(env)
}

pub fn service_environment(env: &Environment) -> Environment {
    ["PATH", "LANG"]
        .into_iter()
        .filter_map(|key| env.get(key).map(|value| (key.into(), value.clone())))
        .collect()
}
