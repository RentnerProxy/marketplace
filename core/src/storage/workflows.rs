//! Coarse filesystem workflows. Every invocation reopens and validates its roots.
mod backup_delete;
mod backup_files;
mod branding;

use super::{files::*, invalid, string};
use crate::protocol::{CoreError, CoreResult, OperationContext};
use cap_std::fs::Dir;
use serde_json::{Value, json};
use std::path::PathBuf;

pub(crate) struct BackupRoots {
    pub(crate) backup_path: PathBuf,
    pub(crate) backup: Dir,
    pub(crate) storage_path: PathBuf,
    pub(crate) storage: Dir,
}

pub(crate) fn backup_roots(request: &Value, context: &OperationContext) -> CoreResult<BackupRoots> {
    context.check()?;
    let backup_path = absolute(string(request, "backupDirectory")?)?;
    let storage_path = absolute(string(request, "storageDirectory")?)?;
    let overlap = || {
        CoreError::new(
            "BACKUP_ROOT_OVERLAP",
            "Der Backup-Ordner darf nicht innerhalb des App-Storage liegen.",
        )
    };
    if backup_path.starts_with(&storage_path) {
        return Err(overlap());
    }
    // Reject aliases into storage with the original domain error before the
    // stricter no-follow walk below rejects aliases in general.
    if let (Ok(backup), Ok(storage)) = (
        std::fs::canonicalize(&backup_path),
        std::fs::canonicalize(&storage_path),
    ) && backup.starts_with(&storage)
    {
        return Err(overlap());
    }
    if backup_path.parent().is_none() || storage_path.parent().is_none() {
        return Err(invalid());
    }
    let backup = open_absolute(&backup_path, true)?;
    secure_directory(&backup)?;
    let storage = open_absolute(&storage_path, true)?;
    let canonical_backup = std::fs::canonicalize(&backup_path)?;
    let canonical_storage = std::fs::canonicalize(&storage_path)?;
    if canonical_backup.starts_with(&canonical_storage)
        || same(&backup.dir_metadata()?, &storage.dir_metadata()?)
    {
        return Err(overlap());
    }
    context.check()?;
    assert_location(&backup_path, &backup)?;
    assert_location(&storage_path, &storage)?;
    Ok(BackupRoots {
        backup_path,
        backup,
        storage_path,
        storage,
    })
}

fn backup_paths(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let names = request["fileNames"]
        .as_array()
        .filter(|names| names.len() <= 1024)
        .ok_or_else(invalid)?;
    let mut validated = Vec::with_capacity(names.len());
    for name in names {
        let name = name
            .as_str()
            .filter(|name| {
                !name.is_empty()
                    && name.len() <= 255
                    && *name != "."
                    && *name != ".."
                    && name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            })
            .ok_or_else(|| CoreError::new("BACKUP_INVALID_NAME", "Ungültiger Backup-Dateiname."))?;
        validated.push(name);
    }
    let roots = backup_roots(request, context)?;
    let paths: Vec<_> = validated
        .into_iter()
        .map(|name| absolute(roots.backup_path.join(name).to_str().ok_or_else(invalid)?))
        .collect::<CoreResult<_>>()?;
    for path in &paths {
        relative(&roots.backup_path, path, false)?;
    }
    context.check()?;
    assert_location(&roots.backup_path, &roots.backup)?;
    assert_location(&roots.storage_path, &roots.storage)?;
    Ok(json!({"paths":paths}))
}

pub(crate) fn execute(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    match string(request, "operation")? {
        "backupPreparePaths" => backup_paths(request, context),
        "backupDeleteFiles" => backup_delete::execute(request, context),
        "brandingPublish" => branding::publish(request, context),
        "backupPublishFile" => backup_files::publish(request, context),
        _ => Err(invalid()),
    }
}

pub(crate) fn publish_branding_bytes(
    request: &Value,
    bytes: &[u8],
    context: &OperationContext,
) -> CoreResult<Value> {
    branding::publish_bytes(request, bytes, context)
}
