//! Bounded state validation and durable, handle-relative atomic publication.
use super::{files, string, workflows};
use crate::protocol::{CoreError, CoreResult, OperationContext};
use crate::validation::valid_iso_timestamp;
use cap_fs_ext::MetadataExt;
use cap_std::fs::{Dir, Metadata};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{Read, Write},
    path::Path,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const NAME: &str = ".restore-state-v1.json";
const MAX_BYTES: u64 = 64 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[cfg(test)]
#[path = "../../tests/unit/storage_restore_state.rs"]
mod fault_tests;

fn invalid() -> CoreError {
    CoreError::new(
        "RESTORE_STATE_INVALID",
        "Der globale Restore-Status ist ungültig oder nicht unterstützt.",
    )
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    version: u8,
    status: String,
    phase: String,
    percent: Option<u8>,
    processed_bytes: u64,
    total_bytes: u64,
    started_at: String,
    updated_at: String,
}
fn valid_date(value: &str) -> bool {
    valid_iso_timestamp(value) && OffsetDateTime::parse(value, &Rfc3339).is_ok()
}
fn validate(value: Value) -> CoreResult<State> {
    // `percent` is required even when null; Serde's Option alone accepts absence.
    if value.get("percent").is_none() {
        return Err(invalid());
    }
    let state: State = serde_json::from_value(value).map_err(|_| invalid())?;
    if state.version != 1
        || !["running", "completed", "failed", "recovery-required"].contains(&state.status.as_str())
        || ![
            "preparing",
            "validating",
            "creating-recovery",
            "replacing-storage",
            "restoring-database",
            "finalizing",
            "rolling-back",
        ]
        .contains(&state.phase.as_str())
        || state.percent.is_some_and(|percent| percent > 100)
        || state.processed_bytes > state.total_bytes
        || state.total_bytes > MAX_SAFE_INTEGER
        || !valid_date(&state.started_at)
        || !valid_date(&state.updated_at)
    {
        return Err(invalid());
    }
    if serde_json::to_vec(&state)?.len() as u64 > MAX_BYTES {
        return Err(invalid());
    }
    Ok(state)
}

pub(crate) fn execute(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    let state = if string(request, "operation")? == "restoreStateWrite" {
        Some(validate(request["state"].clone())?)
    } else {
        None
    };
    if let Some(state) = state {
        let roots = workflows::backup_roots(request, context)?;
        return write_state(state, &roots, context, files::sync_dir);
    }
    let Some(roots) = workflows::read_backup_roots(request, context)? else {
        return Ok(Value::Null);
    };
    let Some((_, bytes)) = read_bytes(&roots, context)? else {
        return Ok(Value::Null);
    };
    let value = serde_json::from_slice(&bytes).map_err(|_| {
        CoreError::new(
            "RESTORE_STATE_CORRUPT",
            "Der globale Restore-Status ist beschädigt.",
        )
    })?;
    Ok(serde_json::to_value(validate(value)?)?)
}

fn private(metadata: &Metadata) -> CoreResult<()> {
    if !metadata.is_file() || metadata.is_symlink() || metadata.nlink() != 1 {
        return Err(invalid());
    }
    #[cfg(unix)]
    if cap_std::fs::MetadataExt::mode(metadata) & 0o077 != 0 {
        return Err(invalid());
    }
    Ok(())
}

fn read_bytes(
    roots: &workflows::BackupRoots,
    context: &OperationContext,
) -> CoreResult<Option<(Metadata, Vec<u8>)>> {
    // Preflight rejects FIFOs/devices before opening. The nonblocking nofollow
    // open also remains bounded if the name changes after that preflight.
    let (mut file, before) = match files::open_read_with_metadata(&roots.backup, Path::new(NAME)) {
        Ok(file) => file,
        Err(error) if error.code == "ENOENT" => {
            context.check()?;
            roots.assert_locations()?;
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    private(&before)?;
    if before.len() > MAX_BYTES {
        return Err(invalid());
    }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    (&mut file).take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    let after = file.metadata()?;
    let named = roots.backup.symlink_metadata(NAME)?;
    context.check()?;
    roots.assert_locations()?;
    private(&after)?;
    private(&named)?;
    if bytes.len() as u64 != before.len()
        || !files::same(&before, &after)
        || !files::same(&before, &named)
        || after.len() != before.len()
        || before.modified()? != after.modified()?
    {
        return Err(invalid());
    }
    Ok(Some((before, bytes)))
}

fn write_state(
    state: State,
    roots: &workflows::BackupRoots,
    context: &OperationContext,
    sync_directory: impl FnOnce(&Dir) -> CoreResult<()>,
) -> CoreResult<Value> {
    let serialized = serde_json::to_vec(&state)?;
    let temporary = format!(".restore-state-{}.tmp", uuid::Uuid::new_v4());
    let mut file = files::create_file(&roots.backup, Path::new(&temporary))?;
    let owned = file.metadata()?;
    let result = (|| {
        file.write_all(&serialized)?;
        file.sync_all()?;
        roots.assert_locations()?;
        let current = roots.backup.symlink_metadata(&temporary)?;
        private(&current)?;
        if !files::same(&owned, &current) || current.len() != serialized.len() as u64 {
            return Err(invalid());
        }
        drop(file);
        context.check_now()?;
        super::recovery::rename_retry(
            &roots.backup,
            Path::new(&temporary),
            &roots.backup,
            Path::new(NAME),
            context,
        )?;
        // Rename has committed visibility. Every subsequent failure is uncertain;
        // callers must not infer that an earlier state remains authoritative.
        let confirm = (|| {
            sync_directory(&roots.backup)?;
            let (published, bytes) = read_bytes(roots, context)?.ok_or_else(invalid)?;
            if !files::same(&owned, &published) || bytes != serialized {
                return Err(invalid());
            }
            Ok(serde_json::to_value(state)?)
        })();
        confirm.map_err(|_: CoreError| {
            CoreError::new(
                "CORE_OPERATION_UNCERTAIN",
                "Die Veröffentlichung des Restore-Status konnte nicht bestätigt werden.",
            )
        })
    })();
    // Remove only our original temporary inode. A published destination or a
    // foreign replacement is never deleted during failure cleanup.
    if roots
        .backup
        .symlink_metadata(&temporary)
        .is_ok_and(|actual| files::same(&actual, &owned))
    {
        let _ = roots.backup.remove_file(&temporary);
    }
    result
}
