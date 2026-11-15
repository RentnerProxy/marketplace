use super::{MAX_BYTES, invalid};
use crate::protocol::CoreResult;
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::fmt::Write as _;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use zeroize::Zeroizing;

const INITIAL_HMAC: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Binding {
    pub restore_run_id: String,
    actor_user_id: String,
    source_backup_id: String,
    source_checksum_sha256: String,
    includes_storage: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Record {
    version: u8,
    purpose: String,
    algorithm: String,
    restore_run_id: String,
    actor_user_id: String,
    source_backup_id: String,
    source_checksum_sha256: String,
    includes_storage: bool,
    sequence: u8,
    event: String,
    occurred_at: String,
    previous_hmac_sha256: String,
    hmac_sha256: String,
}

fn checksum(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn uuid(value: &str) -> bool {
    if value.len() != 36 || value != value.to_ascii_lowercase() {
        return false;
    }
    let Ok(parsed) = uuid::Uuid::parse_str(value) else {
        return false;
    };
    if parsed.hyphenated().to_string() != value {
        return false;
    }
    parsed.is_nil()
        || parsed == uuid::Uuid::max()
        || ((1..=8).contains(&(parsed.as_bytes()[6] >> 4)) && parsed.as_bytes()[8] & 0xc0 == 0x80)
}
pub(super) fn parse_binding(value: &Value) -> CoreResult<Binding> {
    let binding: Binding = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if !uuid(&binding.restore_run_id)
        || !uuid(&binding.actor_user_id)
        || !uuid(&binding.source_backup_id)
        || !checksum(&binding.source_checksum_sha256)
    {
        return Err(invalid());
    }
    Ok(binding)
}
pub(super) fn derive(master: &[u8]) -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(b"tanstack-restore-journal-key-v1"), master)
        .expand(b"restore-journal-integrity-v1", key.as_mut())
        .expect("32 Byte liegen innerhalb des HKDF-SHA-256-Ausgabelimits.");
    key
}
fn transition(previous: Option<&str>, event: &str) -> CoreResult<()> {
    let allowed: &[&str] = match previous {
        None => &["started"],
        Some("started") => &["rewind-ready", "failed", "recovery-required"],
        Some("rewind-ready") => &["applied", "failed", "recovery-required"],
        Some("applied") => &["completed", "failed", "recovery-required"],
        Some("completed" | "failed") => &["recovery-required"],
        _ => &[],
    };
    if !allowed.contains(&event) {
        return Err(invalid());
    }
    Ok(())
}
fn fields(record: &Record) -> Vec<u8> {
    serde_json::to_vec(&(
        &record.purpose,
        record.version,
        &record.algorithm,
        &record.restore_run_id,
        &record.actor_user_id,
        &record.source_backup_id,
        &record.source_checksum_sha256,
        record.includes_storage,
        record.sequence,
        &record.event,
        &record.occurred_at,
        &record.previous_hmac_sha256,
    ))
    .expect("JSON-Zeichenketten sind serialisierbar.")
}
fn mac(record: &Record, key: &[u8]) -> Hmac<Sha256> {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(key).expect("HMAC akzeptiert Schlüssel beliebiger Länge.");
    mac.update(&fields(record));
    mac
}
fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(output, "{byte:02x}").expect("Das Schreiben in eine Zeichenkette ist unfehlbar.");
    }
    output
}
fn timestamp(value: OffsetDateTime) -> CoreResult<String> {
    let value = value.to_offset(time::UtcOffset::UTC);
    Ok(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        value.year(),
        value.month() as u8,
        value.day(),
        value.hour(),
        value.minute(),
        value.second(),
        value.millisecond()
    ))
}
pub(super) fn next(
    binding: &Binding,
    previous: Option<&Record>,
    event: &str,
    key: &[u8],
) -> CoreResult<Record> {
    transition(previous.map(|record| record.event.as_str()), event)?;
    let mut record = Record {
        version: 1,
        purpose: "restore-journal-v1".into(),
        algorithm: "hmac-sha256".into(),
        restore_run_id: binding.restore_run_id.clone(),
        actor_user_id: binding.actor_user_id.clone(),
        source_backup_id: binding.source_backup_id.clone(),
        source_checksum_sha256: binding.source_checksum_sha256.clone(),
        includes_storage: binding.includes_storage,
        sequence: previous.map_or(1, |record| record.sequence + 1),
        event: event.into(),
        occurred_at: timestamp(OffsetDateTime::now_utc())?,
        previous_hmac_sha256: previous
            .map_or(INITIAL_HMAC, |record| record.hmac_sha256.as_str())
            .to_owned(),
        hmac_sha256: String::new(),
    };
    if record.sequence > 8 {
        return Err(invalid());
    }
    record.hmac_sha256 = hex(&mac(&record, key).finalize().into_bytes());
    Ok(record)
}
pub(super) fn serialize(record: &Record) -> CoreResult<Vec<u8>> {
    let mut bytes = serde_json::to_vec(record)?;
    bytes.push(b'\n');
    Ok(bytes)
}
pub(super) fn validate(content: &[u8], binding: &Binding, key: &[u8]) -> CoreResult<Vec<Record>> {
    if content.is_empty() || content.len() > MAX_BYTES || content.last() != Some(&b'\n') {
        return Err(invalid());
    }
    let text = std::str::from_utf8(content).map_err(|_| invalid())?;
    let mut records: Vec<Record> = Vec::new();
    for line in text[..text.len() - 1].split('\n') {
        if records.len() >= 8 {
            return Err(invalid());
        }
        let record: Record = serde_json::from_str(line).map_err(|_| invalid())?;
        let previous = records.last();
        if record.version != 1
            || record.purpose != "restore-journal-v1"
            || record.algorithm != "hmac-sha256"
            || record.restore_run_id != binding.restore_run_id
            || record.actor_user_id != binding.actor_user_id
            || record.source_backup_id != binding.source_backup_id
            || record.source_checksum_sha256 != binding.source_checksum_sha256
            || record.includes_storage != binding.includes_storage
            || record.sequence as usize != records.len() + 1
            || record.previous_hmac_sha256
                != previous.map_or(INITIAL_HMAC, |record| record.hmac_sha256.as_str())
            || !checksum(&record.hmac_sha256)
            || !checksum(&record.previous_hmac_sha256)
        {
            return Err(invalid());
        }
        let date = OffsetDateTime::parse(&record.occurred_at, &Rfc3339).map_err(|_| invalid())?;
        if timestamp(date)? != record.occurred_at {
            return Err(invalid());
        }
        transition(previous.map(|record| record.event.as_str()), &record.event)?;
        let mut digest = [0; 32];
        for (index, byte) in digest.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&record.hmac_sha256[index * 2..index * 2 + 2], 16)
                .map_err(|_| invalid())?;
        }
        mac(&record, key)
            .verify_slice(&digest)
            .map_err(|_| invalid())?;
        if serde_json::to_vec(&record)? != line.as_bytes() {
            return Err(invalid());
        }
        records.push(record);
    }
    Ok(records)
}
