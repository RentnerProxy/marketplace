//! Handle-relative private filesystem operations. Lexical checks select scope;
//! no-follow directory handles enforce it while filesystem operations execute.
mod fence;
#[path = "storage/files.rs"]
pub(crate) mod files;
mod journal_session;
#[path = "storage/recovery.rs"]
mod recovery;
mod restore_journal;
mod restore_state;
pub(crate) mod workflows;

use crate::protocol::{CoreError, CoreResult, OperationContext, WorkerResponse, branding_lengths};
use serde_json::{Value, json};

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
                branding_lengths(request, bytes.len() as u64)?;
                workflows::publish_branding_bytes(request, bytes, context).map(WorkerResponse::Json)
            }
            _ => Err(invalid()),
        };
    }
    if request.get("binaryLengths").is_some() {
        return Err(invalid());
    }
    if request["operation"] == "readBackgroundBytes" {
        context.check()?;
        return Ok(match files::read_background_bytes(request, context)? {
            Some(bytes) => WorkerResponse::Binary(bytes),
            None => WorkerResponse::Json(Value::Null),
        });
    }
    execute_ref(request, context).map(WorkerResponse::Json)
}

pub fn execute_ref(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    if request.get("binaryLengths").is_some() {
        return Err(invalid());
    }
    match string(request, "operation")? {
        "prepareDirectories" => files::prepare(request),
        "assertDirectories" => files::assert_snapshots(request),
        "writeFile" => files::write(request, context),
        "readFile" => files::read(request, context),
        "readBackground" => files::read_background(request, context),
        "syncTree" => {
            recovery::sync_tree_path(string(request, "path")?, context)?;
            Ok(Value::Null)
        }
        "recoveryPrepare" => recovery::prepare(request, context),
        "recoveryFinish" => recovery::finish(request, context),
        "capacity" => recovery::capacity(request, context),
        "fenceAdmitShared" | "fenceAcquireExclusive" | "fenceRelease" | "fenceDrain" => {
            fence::execute(request, context)
        }
        "restoreStateGet" | "restoreStateWrite" => restore_state::execute(request, context),
        "journalValidate" => restore_journal::execute(request, context),
        "backupPreparePaths" | "backupDeleteFiles" | "backupPublishFile" | "brandingPublish" => {
            workflows::execute(request, context)
        }
        "syncFile" | "syncDirectory" | "rename" | "remove" | "tempDirectory" | "permissions" => {
            files::utility(request, context)
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
