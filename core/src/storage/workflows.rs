//! Coarse filesystem workflows. Every invocation reopens and validates its roots.
mod backup_delete;
mod backup_files;
mod branding;

use super::{files::*, invalid, string};
use crate::protocol::{CoreError, CoreResult, OperationContext};
use cap_std::fs::Dir;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

pub(crate) struct BackupRoots {
    pub(crate) backup_path: PathBuf,
    pub(crate) backup: Dir,
    storage_path: PathBuf,
    storage: Option<Dir>,
}

fn overlap() -> CoreError {
    CoreError::new(
        "BACKUP_ROOT_OVERLAP",
        "Der Backup-Ordner darf nicht innerhalb des App-Storage liegen.",
    )
}

fn aliases_storage(backup: &Path, storage: &Path) -> bool {
    std::fs::canonicalize(backup)
        .and_then(|backup| Ok(backup.starts_with(std::fs::canonicalize(storage)?)))
        .unwrap_or(false)
}

fn load_backup_roots(
    request: &Value,
    context: &OperationContext,
    create: bool,
) -> CoreResult<Option<BackupRoots>> {
    context.check()?;
    let backup_path = absolute(string(request, "backupDirectory")?)?;
    let storage_path = absolute(string(request, "storageDirectory")?)?;
    if backup_path.starts_with(&storage_path) {
        return Err(overlap());
    }
    if backup_path.parent().is_none() || storage_path.parent().is_none() {
        return Err(invalid());
    }

    let open_root = |path: &Path| match open_absolute(path, create) {
        Ok(root) => Ok(Some(root)),
        Err(error) if !create && error.code == "ENOENT" => Ok(None),
        Err(error) => Err(error),
    };
    let open_roots = || Ok((open_root(&backup_path)?, open_root(&storage_path)?));
    let (backup, storage) = open_roots().map_err(|error| {
        if aliases_storage(&backup_path, &storage_path) {
            overlap()
        } else {
            error
        }
    })?;
    let Some(backup) = backup else {
        return Ok(None);
    };

    let backup_metadata = backup.dir_metadata()?;
    // Case-insensitive filesystem paths can pass lexical containment.
    if let Some(storage) = &storage
        && (same(&backup_metadata, &storage.dir_metadata()?)
            || std::fs::canonicalize(&backup_path)?
                .starts_with(std::fs::canonicalize(&storage_path)?))
    {
        return Err(overlap());
    }
    if create {
        assert_location(&backup_path, &backup)?;
        prepare_private_directory(&backup)?;
    } else {
        verify_configured_directory(&backup_metadata)?;
    }
    context.check()?;
    Ok(Some(BackupRoots {
        backup_path,
        backup,
        storage_path,
        storage,
    }))
}

pub(crate) fn backup_roots(request: &Value, context: &OperationContext) -> CoreResult<BackupRoots> {
    let roots = load_backup_roots(request, context, true)?.ok_or_else(invalid)?;
    roots.assert_locations()?;
    Ok(roots)
}

pub(super) fn read_backup_roots(
    request: &Value,
    context: &OperationContext,
) -> CoreResult<Option<BackupRoots>> {
    load_backup_roots(request, context, false)
}

impl BackupRoots {
    pub(super) fn assert_locations(&self) -> CoreResult<()> {
        assert_location(&self.backup_path, &self.backup)?;
        if let Some(storage) = &self.storage {
            return assert_location(&self.storage_path, storage);
        }
        // A read may see an uninitialized storage root. Reject a path that
        // appears during the read instead of returning a stale observation.
        match open_absolute(&self.storage_path, false) {
            Err(error) if error.code == "ENOENT" => Ok(()),
            Err(error) => Err(error),
            Ok(_) => Err(invalid()),
        }
    }
}

fn invalid_name() -> CoreError {
    CoreError::new("BACKUP_INVALID_NAME", "Ungültiger Backup-Dateiname.")
}

fn backup_filename(value: &Value) -> CoreResult<&str> {
    let name = value
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
        .ok_or_else(invalid_name)?;
    #[cfg(windows)]
    if !valid_windows_component(name) {
        return Err(invalid_name());
    }
    Ok(name)
}

fn backup_paths(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let names = request["fileNames"]
        .as_array()
        .filter(|names| names.len() <= 1024)
        .ok_or_else(invalid)?;
    let validated = names
        .iter()
        .map(backup_filename)
        .collect::<CoreResult<Vec<_>>>()?;
    // Prepare the backup directory before returning paths for archive creation.
    let roots = load_backup_roots(request, context, true)?.ok_or_else(invalid)?;
    let paths: Vec<_> = validated
        .into_iter()
        .map(|name| roots.backup_path.join(name))
        .collect();
    context.check()?;
    roots.assert_locations()?;
    Ok(json!({"paths":paths}))
}

pub(crate) fn execute(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    match string(request, "operation")? {
        "backupPreparePaths" => backup_paths(request, context),
        "backupDeleteFiles" => backup_delete::execute(request, context),
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
