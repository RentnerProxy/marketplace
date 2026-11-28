use regex_lite::Regex;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    fmt::Write as _,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub const MAX_LINE: usize = 4096;
const MAX_ENTRIES: usize = 300;

#[derive(Clone, Serialize)]
pub struct LogEntry {
    pub id: String,
    pub timestamp: String,
    pub level: String,
    pub event: String,
    pub message: String,
    pub context: Value,
}

fn patterns() -> &'static Vec<(Regex, &'static str)> {
    static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    PATTERNS.get_or_init(|| [
        (r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))", ""),
        (r"(?i)([a-z%FOLD][a-z0-9+.%FOLD-]*://)[^%SPACE/@]+@", "${1}[REDACTED]@"),
        (r#"(?i)([?#&](?:acce%S%S|to%Ken|%Secret|pa%S%Sword|code|%Key|api_%Key|acce%S%S_to%Ken|refre%Sh_to%Ken)=)[^&#%SPACE\"'<>]+"#, "${1}[REDACTED]"),
        (r#"(?i)(\"(?:[^\"%SPACE]*%KEY|%HEADER)\"[%SPACE]*:[%SPACE]*)\"(?:\\.|[^\"\\])*\""#, "${1}\"[REDACTED]\""),
        (r#"(?i)\b{start-half}([a-z0-9_%FOLD]*%KEY[%SPACE]*[=:][%SPACE]*)(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^%SPACE,;]+)"#, "${1}[REDACTED]"),
        (r"(?i)\b{start-half}(%HEADER[%SPACE]*[:=][%SPACE]*).+", "${1}[REDACTED]"),
        (r"(?i)\b((?:Bearer|Ba%Sic)[%SPACE]+)[a-z0-9+/_=.%FOLD-]+", "${1}[REDACTED]"),
        (r"(?i)\beyJ[a-z0-9_%FOLD-]+\.[a-z0-9_%FOLD-]+\.[a-z0-9_%FOLD-]*(?:[a-z0-9_-]\b|[%FOLD]\b{end-half})", "[REDACTED]"),
        (r"\b((?:STATEMENT|DETAIL|CONTEXT|QUERY):[%SPACE]*).+", "${1}[REDACTED]"),
    ].into_iter().map(|(pattern, replacement)| (redaction_pattern(pattern), replacement)).collect())
}

fn redaction_pattern(pattern: &str) -> Regex {
    // Retain the Unicode space and ASCII-letter case folds that the previous
    // engine matched implicitly, so those spellings still redact secrets.
    let pattern = pattern
        .replace(
            "%KEY",
            "(?:pa%S%Sword|%Secret|to%Ken|encryption_%Key|api_%Key)",
        )
        .replace("%HEADER", "(?:authorization|coo%Kie|%Set-coo%Kie)")
        .replace(
            "%SPACE",
            r"\s\x{85}\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}",
        )
        .replace("%FOLD", r"\x{17f}\x{212a}")
        .replace("%S", r"[s\x{17f}]")
        .replace("%K", r"[k\x{212a}]");
    Regex::new(&pattern).expect("static log redaction expression")
}

pub fn redact_line(message: &str) -> String {
    let mut value = message.to_owned();
    for (pattern, replacement) in patterns() {
        if let std::borrow::Cow::Owned(redacted) = pattern.replace_all(&value, *replacement) {
            value = redacted;
        }
    }
    value.retain(|character| !character.is_control() || character == '\t');
    if value.encode_utf16().count() > MAX_LINE {
        let mut units = 0;
        value = value
            .chars()
            .take_while(|character| {
                units += character.len_utf16();
                units <= MAX_LINE
            })
            .chain(['…'])
            .collect();
    }
    value
}

fn valid_event(event: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| event.starts_with(prefix))
        && event.len() <= 120
        && event.bytes().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, b'.' | b'_' | b'-')
        })
        && event.split('.').count() <= 9
        && event.split('.').all(|part| !part.is_empty())
}

type History = HashMap<String, VecDeque<(Instant, LogEntry)>>;
pub struct LogStore {
    entries: Mutex<(u64, History)>,
    secrets: Vec<String>,
}

impl LogStore {
    pub fn new(secrets: Vec<String>) -> Self {
        let secrets = secrets
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect();
        Self {
            entries: Mutex::new((0, HashMap::new())),
            secrets,
        }
    }

    pub fn append(&self, role: &str, message: &str, stderr: bool) {
        let mut sanitized = message.to_owned();
        for secret in &self.secrets {
            sanitized = sanitized.replace(secret, "[REDACTED]");
        }
        static LEVELS: OnceLock<(Regex, Regex)> = OnceLock::new();
        let levels = LEVELS.get_or_init(|| {
            (
                Regex::new(r"(?i)\b(?:ERROR|FATAL|PANIC)\b").expect("static error expression"),
                Regex::new(r"(?i)\b(?:WARN|WARNING)\b").expect("static warning expression"),
            )
        });
        let parsed = serde_json::from_str::<Value>(message).ok();
        let service = parsed.as_ref().and_then(|value| {
            let service = value.get("service").and_then(Value::as_str);
            let context_service = value.pointer("/context/service").and_then(Value::as_str);
            service
                .or(context_service)
                .filter(|service| context_service.is_none_or(|context| context == *service))
        });
        let level = parsed
            .as_ref()
            .and_then(|value| value.get("level"))
            .and_then(Value::as_str)
            .filter(|level| matches!(*level, "info" | "warn" | "error"))
            .unwrap_or_else(|| {
                if levels.0.is_match(message) {
                    "error"
                } else if levels.1.is_match(message) {
                    "warn"
                } else {
                    "info"
                }
            });
        let sanitized = redact_line(&sanitized);
        self.insert(
            role,
            level,
            if stderr {
                "container.stderr"
            } else {
                "container.stdout"
            },
            &sanitized,
        );
        if matches!(role, "webserver" | "worker") && service == Some("core") {
            let event = parsed
                .as_ref()
                .and_then(|value| value.get("event"))
                .and_then(Value::as_str)
                .filter(|event| valid_event(event, &["core."]))
                .unwrap_or("core.operation");
            self.insert("core", level, event, &sanitized);
        }
        if role == "webserver"
            && service == Some("websocket")
            && let Some(value) = parsed.as_ref()
            && let Some(event) = value.get("event").and_then(Value::as_str)
            && valid_event(event, &["realtime.", "websocket."])
            && !self.secrets.iter().any(|secret| event.contains(secret))
        {
            // Forward only the event identifier, never arbitrary websocket payloads or context.
            self.insert("websocket", level, event, event);
        }
    }

    pub fn event(&self, event: &str, level: &str, message: &str) {
        let message = redact_line(message);
        eprintln!("[core] {event}: {message}");
        self.insert("core", level, event, &message);
    }

    fn insert(&self, role: &str, level: &str, event: &str, message: &str) {
        let mut state = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.0 += 1;
        let digest = Sha256::digest(
            format!(
                "{}:{}:{}",
                std::process::id(),
                state.0,
                OffsetDateTime::now_utc().unix_timestamp_nanos()
            )
            .as_bytes(),
        );
        let mut id = String::with_capacity(64);
        for byte in digest.iter() {
            let _ = write!(id, "{byte:02x}");
        }
        let entry = LogEntry {
            id,
            timestamp: OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .unwrap_or_default(),
            level: level.into(),
            event: event.into(),
            message: message.into(),
            context: json!({"service": role}),
        };
        let entries = state.1.entry(role.into()).or_default();
        entries.push_back((Instant::now(), entry));
        while entries.len() > MAX_ENTRIES {
            entries.pop_front();
        }
    }

    pub fn snapshot(&self, role: &str) -> Value {
        let state = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let entries: Vec<_> = state
            .1
            .get(role)
            .into_iter()
            .flatten()
            .filter(|(time, _)| time.elapsed() <= Duration::from_secs(3600))
            .map(|(_, entry)| entry)
            .collect();
        json!({"source":"container", "sharedHistoryAvailable":true, "entries":entries})
    }
}

#[cfg(test)]
#[path = "../../tests/unit/appliance_logs.rs"]
mod tests;
