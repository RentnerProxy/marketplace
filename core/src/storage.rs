//! Handle-relative private filesystem operations. Lexical checks select scope;
//! no-follow directory handles enforce it while filesystem operations execute.
mod fence;
#[path = "storage/files.rs"]
pub(crate) mod files;
mod journal_session;
mod native;
#[path = "storage/recovery.rs"]
mod recovery;
mod restore_journal;
mod restore_state;
pub(crate) mod workflows;

use crate::protocol::{CoreError, CoreResult, OperationContext, WorkerResponse};
use serde_json::{Value, json};

pub use native::{MAX_NATIVE_BINARY_BYTES, MAX_NATIVE_REQUEST_BYTES, execute_native};

pub fn execute(request: Value, context: &OperationContext) -> CoreResult<Value> {
    execute_ref(&request, context)
}

pub fn execute_worker(
    request: &Value,
    binary: Option<&[u8]>,
    context: &OperationContext,
) -> CoreResult<WorkerResponse> {
    if let Some(bytes) = binary {
        context.check()?;
        return match request["operation"].as_str() {
            Some("writeFile")
                if request.get("dataBase64").is_none()
                    && request.get("binaryLengths").is_none() =>
            {
                files::write_bytes(request, bytes, context).map(WorkerResponse::Json)
            }
            Some("brandingPublish") => {
                workflows::publish_branding_bytes(request, bytes, context).map(WorkerResponse::Json)
            }
            _ => Err(invalid()),
        };
    }
    if request.get("binaryLengths").is_some() {
        return Err(invalid());
    }
    match request["operation"].as_str() {
        Some("readBackgroundRepresentation") => {
            context.check()?;
            Ok(
                match files::read_background_representation(request, context)? {
                    Some((version, bytes)) => WorkerResponse::VersionedBinary { bytes, version },
                    None => WorkerResponse::Json(Value::Null),
                },
            )
        }
        _ => execute_ref(request, context).map(WorkerResponse::Json),
    }
}

pub fn execute_ref(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    if request.get("binaryLengths").is_some() {
        return Err(invalid());
    }
    match string(request, "operation")? {
        "prepareDirectories" => files::prepare(request),
        "statBackground" => files::stat_background(request, context),
        "syncTree" => {
            let directories_only = match request.get("directoriesOnly") {
                None => false,
                Some(value) => value.as_bool().ok_or_else(invalid)?,
            };
            recovery::sync_tree_path(string(request, "path")?, directories_only, context)?;
            Ok(Value::Null)
        }
        "recoveryPrepare" => recovery::prepare(request, context),
        "recoveryFinish" => recovery::finish(request, context),
        "capacity" => recovery::capacity(request, context),
        "fenceAdmitShared" | "fenceAcquireExclusive" | "fenceRelease" | "fenceDrain" => {
            fence::execute(request, context)
        }
        "restoreStateGet" | "restoreStateWrite" => restore_state::execute(request, context),
        "backupPreparePaths" | "backupDeleteFiles" | "backupPublishFile" => {
            workflows::execute(request, context)
        }
        "syncFile" | "syncDirectory" | "remove" | "tempDirectory" | "permissions" => {
            files::utility(request)
        }
        "postgresDump" | "postgresRestore" => crate::postgres::execute(request, context),
        _ => Err(CoreError::new(
            "CORE_INVALID_OPERATION",
            "Die Storage-Operation ist ungültig.",
        )),
    }
}

/// Own a restore journal descriptor and key until its final verified close.
pub fn run_journal_session() {
    journal_session::run();
}

pub(crate) fn invalid() -> CoreError {
    CoreError::new(
        "STORAGE_INVALID",
        "Die private Dateioperation konnte nicht sicher abgeschlossen werden.",
    )
}
pub(crate) fn string<'a>(value: &'a Value, key: &str) -> CoreResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && !value.contains('\0'))
        .ok_or_else(invalid)
}
pub(crate) fn success() -> Value {
    json!({"ok": true})
}
