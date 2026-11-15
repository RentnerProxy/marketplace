use super::*;
use cap_fs_ext::MetadataExt;
use std::path::Path;

pub(super) fn publish(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let source_path = absolute(string(request, "sourcePath")?)?;
    let destination_path = absolute(string(request, "destinationPath")?)?;
    if source_path == destination_path {
        return Err(invalid());
    }
    let roots = backup_roots(request, context)?;
    let source_relative = relative(&roots.backup_path, &source_path, false)?;
    let destination_relative = relative(&roots.backup_path, &destination_path, false)?;
    let source_parent = source_relative.parent().unwrap_or(Path::new(""));
    let destination_parent = destination_relative.parent().unwrap_or(Path::new(""));
    let source = descend(&roots.backup, source_parent, false, true)?;
    let destination = descend(&roots.backup, destination_parent, false, true)?;
    let source_name = source_relative.file_name().ok_or_else(invalid)?;
    let destination_name = destination_relative.file_name().ok_or_else(invalid)?;
    let source_file = open_sync(&source, Path::new(source_name))?;
    let owned = source_file.metadata()?;
    if owned.nlink() != 1 {
        return Err(invalid());
    }
    secure_file(&source_file)?;
    source_file.sync_all()?;
    match destination.symlink_metadata(destination_name) {
        Ok(metadata) if !metadata.is_file() || metadata.is_symlink() || same(&owned, &metadata) => {
            return Err(invalid());
        }
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.into()),
    }
    context.check()?;
    assert_location(&roots.backup_path, &roots.backup)?;
    assert_location(&roots.storage_path, &roots.storage)?;
    assert_location(source_path.parent().ok_or_else(invalid)?, &source)?;
    assert_location(destination_path.parent().ok_or_else(invalid)?, &destination)?;
    let current = source.symlink_metadata(source_name)?;
    if !same(&owned, &current)
        || current.nlink() != 1
        || current.len() != owned.len()
        || current.modified()? != owned.modified()?
    {
        return Err(invalid());
    }
    // Close Windows no-delete-sharing handles only after the complete source
    // identity check. The rename stays relative to the validated parent handles.
    drop(source_file);
    super::super::recovery::rename_retry(
        &source,
        Path::new(source_name),
        &destination,
        Path::new(destination_name),
        context,
    )?;
    let confirm = (|| {
        sync_dir(&source)?;
        sync_dir(&destination)?;
        assert_location(&roots.backup_path, &roots.backup)?;
        assert_location(&roots.storage_path, &roots.storage)?;
        assert_location(source_path.parent().ok_or_else(invalid)?, &source)?;
        assert_location(destination_path.parent().ok_or_else(invalid)?, &destination)?;
        let published = destination.symlink_metadata(destination_name)?;
        if !same(&owned, &published)
            || !published.is_file()
            || published.nlink() != 1
            || published.len() != owned.len()
            || published.modified()? != owned.modified()?
        {
            return Err(invalid());
        }
        Ok(super::super::success())
    })();
    confirm.map_err(|_: CoreError| {
        CoreError::new(
            "CORE_OPERATION_UNCERTAIN",
            "Die Veröffentlichung der Backup-Datei konnte nicht bestätigt werden.",
        )
    })
}
