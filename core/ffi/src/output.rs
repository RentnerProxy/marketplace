use marketplace_core::protocol::{CoreError, CoreResult, WorkerResponse};
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Write};
use zeroize::Zeroizing;

const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Metadata<'a> {
    Result { result: &'a Value },
    Error { error: &'a CoreError },
}

#[derive(Default)]
struct MetadataWriter(Zeroizing<Vec<u8>>);

impl Write for MetadataWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > MAX_RECORD_BYTES - self.0.len() {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let length = self.0.len() + bytes.len();
        if length > self.0.capacity() {
            let capacity = length.max(self.0.capacity() * 2).min(MAX_RECORD_BYTES);
            let mut next = Zeroizing::new(Vec::with_capacity(capacity));
            next.extend_from_slice(&self.0);
            // Replacing the wrapper also erases the old allocation.
            self.0 = next;
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Opaque, Rust-owned result referenced by the ABI handle.
pub struct StorageOutput {
    json: Zeroizing<Vec<u8>>,
}

impl StorageOutput {
    pub(super) fn from_result(result: CoreResult<WorkerResponse>) -> Self {
        let metadata = match &result {
            Ok(WorkerResponse::Json(result)) => Metadata::Result { result },
            Ok(WorkerResponse::VersionedBinary { .. }) => return Self::uncertain(),
            Err(error) => Metadata::Error { error },
        };
        let mut json = MetadataWriter::default();
        if serde_json::to_writer(&mut json, &metadata).is_err() {
            // The caller cannot validate a result that exceeded the transport limit.
            return Self::uncertain();
        }
        Self { json: json.0 }
    }

    pub(super) fn uncertain() -> Self {
        const JSON: &str = r#"{"type":"error","error":{"code":"CORE_OPERATION_UNCERTAIN","message":"Der native Storage-Auftrag konnte nicht bestätigt werden."}}"#;
        Self {
            json: Zeroizing::new(JSON.as_bytes().to_vec()),
        }
    }

    pub(super) fn json(&self) -> &[u8] {
        &self.json
    }
}

#[cfg(test)]
#[path = "../tests/unit/output.rs"]
mod tests;
