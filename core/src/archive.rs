//! File-based archive engine. Archive bodies never cross the JSON boundary.
mod admission;
mod background;
mod collection;
mod crypto;
mod file_sync;
mod files;
mod tar;

use crate::protocol::{CoreError, CoreResult, OperationContext};
use base64::Engine;
use serde_json::{Value, json};
use std::path::Path;
use zeroize::Zeroizing;

pub const MAX_ENTRIES: usize = 100_000;
pub const MAX_CONTENT: u64 = 25 * 1024 * 1024 * 1024;
pub const MAX_METADATA: u64 = 64 * 1024;
pub const MAX_PAX: usize = 4096 + 512;
pub const MAX_PLAINTEXT: u64 =
    MAX_CONTENT + MAX_ENTRIES as u64 * (1024 + MAX_PAX as u64 + 1022) + 1024;
pub const MAX_ARCHIVE: u64 = MAX_PLAINTEXT + crypto::ENVELOPE_OVERHEAD;
pub const CHUNK: usize = 65536;

pub(crate) fn invalid(message: &str) -> CoreError {
    CoreError::new("ARCHIVE_INVALID", message)
}
pub(crate) fn text<'a>(request: &'a Value, name: &str) -> CoreResult<&'a str> {
    request
        .get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("Der Archivauftrag ist unvollständig."))
}
pub(crate) fn root_key(request: &Value) -> CoreResult<Zeroizing<Vec<u8>>> {
    let key = Zeroizing::new(
        base64::engine::general_purpose::STANDARD
            .decode(text(request, "key")?)
            .map_err(|_| invalid("Der Backup-Schlüssel ist ungültig."))?,
    );
    if key.len() != 32 {
        return Err(invalid("Der Backup-Schlüssel ist ungültig."));
    }
    Ok(key)
}

pub fn execute(request: Value, context: &OperationContext) -> CoreResult<Value> {
    execute_ref(&request, context)
}

pub fn execute_worker(
    request: &Value,
    binary: Option<&[u8]>,
    context: &OperationContext,
) -> CoreResult<Value> {
    if binary.is_some() {
        return Err(CoreError::new(
            "CORE_INVALID_REQUEST",
            "Der Archivauftrag enthält unerwartete Binärdaten.",
        ));
    }
    execute_ref(request, context)
}

pub fn execute_ref(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    let operation = text(request, "operation")?;
    match operation {
        "validateKey" => {
            let _key = root_key(request)?;
            Ok(Value::Null)
        }
        "authenticate" | "validate" => {
            let key = root_key(request)?;
            let mut reader = crypto::DecryptReader::new(
                Path::new(text(request, "sourcePath")?),
                &key,
                request,
                context,
            )?;
            reader.report_start()?;
            if operation == "authenticate" {
                return Ok(serde_json::to_value(reader.finish()?)?);
            }
            let size = reader.plaintext_size();
            let manifest = tar::validate_stream(&mut reader, size, &key, context);
            let metadata = reader.finish()?;
            Ok(json!({
                "archiveSize": metadata.archive_size,
                "checksumSha256": metadata.checksum_sha256,
                "manifest": manifest?,
            }))
        }
        "extract" => {
            let key = root_key(request)?;
            let temporary_root = Path::new(text(request, "temporaryDirectory")?);
            let temporary = files::temporary_directory(temporary_root, "decrypted-")?;
            let plaintext = temporary.path().join("archive.tar");
            let result = (|| {
                let metadata = crypto::DecryptReader::new(
                    Path::new(text(request, "sourcePath")?),
                    &key,
                    request,
                    context,
                )?
                .write_temporary(&plaintext)?;
                let destination = Path::new(text(request, "destinationDirectory")?);
                let maximum_write = request
                    .get("maximumWriteBytes")
                    .and_then(Value::as_u64)
                    .map(|maximum| {
                        maximum
                            .checked_sub(metadata.plaintext_size)
                            .ok_or_else(|| invalid("Das Archivbudget ist ausgeschöpft."))
                    })
                    .transpose()?;
                let mut extraction_request = request.clone();
                if let Some(maximum) = maximum_write {
                    extraction_request["maximumWriteBytes"] = json!(maximum);
                }
                let manifest = tar::process(
                    &plaintext,
                    &key,
                    Some(destination),
                    &extraction_request,
                    context,
                );
                crate::protocol::clear_value(&mut extraction_request);
                let manifest = manifest?;
                Ok(
                    json!({"archiveSize":metadata.archive_size,"checksumSha256":metadata.checksum_sha256,"manifest":manifest}),
                )
            })();
            temporary.close().map_err(|_| {
                CoreError::new(
                    "ARCHIVE_CLEANUP_INCOMPLETE",
                    "Der temporäre Backup-Klartext konnte nicht vollständig bereinigt werden.",
                )
            })?;
            result
        }
        "create" => collection::create(request, context),
        "backgroundCollect" | "backgroundAssertRoots" | "backgroundPartition" => {
            background::execute(request, context)
        }
        "copy" => files::copy_request(request, context),
        "admissionAcquire"
        | "admissionReserve"
        | "admissionRelease"
        | "admissionMarkIncomplete" => admission::execute(request, context),
        _ => Err(CoreError::new(
            "CORE_UNKNOWN_OPERATION",
            "Der Archivauftrag wird nicht unterstützt.",
        )),
    }
}
