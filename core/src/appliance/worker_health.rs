use crate::appliance::storage::private_file;
use serde::Deserialize;
use std::{
    io::Read,
    os::unix::fs::MetadataExt,
    time::{SystemTime, UNIX_EPOCH},
};

const FILENAME: &str = "rentnerproxy-marketplace-worker-heartbeat.json";
// The bundled image creates the Bun account with this UID.
const BUN_UID: u32 = 1000;
const MAX_BYTES: u64 = 512;
const MAX_CLOCK_SKEW_MS: f64 = 5_000.0;
const MAX_AGE_MS: f64 = 30_000.0;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Status {
    Healthy,
    Unhealthy,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Heartbeat {
    version: f64,
    status: Status,
    updated_at: f64,
    pid: f64,
}

fn safe_integer(value: f64, minimum: f64) -> bool {
    (minimum..=MAX_SAFE_INTEGER).contains(&value) && value.fract() == 0.0
}

fn is_current(bytes: &[u8], now_ms: f64) -> bool {
    let Ok(heartbeat) = serde_json::from_slice::<Heartbeat>(bytes) else {
        return false;
    };
    heartbeat.version == 1.0
        && heartbeat.status == Status::Healthy
        && safe_integer(heartbeat.updated_at, 0.0)
        && safe_integer(heartbeat.pid, 1.0)
        && (-MAX_CLOCK_SKEW_MS..=MAX_AGE_MS).contains(&(now_ms - heartbeat.updated_at))
}

fn check(directory: &str, uid: u32, now_ms: f64) -> bool {
    let Ok(file) = private_file(directory, FILENAME, false) else {
        return false;
    };
    let Ok(metadata) = file.metadata() else {
        return false;
    };
    if metadata.uid() != uid
        || metadata.nlink() != 1
        || metadata.mode() & 0o7777 != 0o600
        || metadata.len() > MAX_BYTES
    {
        return false;
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).is_ok()
        && bytes.len() as u64 <= MAX_BYTES
        && is_current(&bytes, now_ms)
}

pub(super) fn probe() -> bool {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .is_ok_and(|duration| check("/tmp", BUN_UID, duration.as_millis() as f64))
}

#[cfg(test)]
#[path = "../../tests/unit/appliance_worker_health.rs"]
mod tests;
