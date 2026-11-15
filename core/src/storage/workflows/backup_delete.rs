use super::*;
use cap_fs_ext::MetadataExt;
use std::{collections::HashSet, path::Path};

pub(super) fn execute(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let names = request["fileNames"]
        .as_array()
        .filter(|names| names.len() <= 1024)
        .ok_or_else(invalid)?;
    let mut seen = HashSet::with_capacity(names.len());
    let mut validated = Vec::with_capacity(names.len());
    // Validate the complete batch before opening or creating either root.
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
            .ok_or_else(invalid_name)?;
        #[cfg(windows)]
        let key = {
            let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
            if name.ends_with('.')
                || ["con", "prn", "aux", "nul"].contains(&stem.as_str())
                || (stem.len() == 4
                    && (stem.starts_with("com") || stem.starts_with("lpt"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
            {
                return Err(invalid_name());
            }
            name.to_ascii_lowercase()
        };
        #[cfg(not(windows))]
        let key = name;
        if !seen.insert(key) {
            return Err(invalid_name());
        }
        validated.push(name);
    }

    let roots = backup_roots(request, context)?;
    let mut files = Vec::with_capacity(validated.len());
    for name in validated {
        context.check()?;
        let owned = match roots.backup.symlink_metadata(name) {
            Ok(metadata) => {
                if !metadata.is_file() || metadata.is_symlink() || metadata.nlink() != 1 {
                    return Err(invalid());
                }
                let file = open_read(&roots.backup, Path::new(name))?;
                let owned = file.metadata()?;
                if !same(&metadata, &owned) || owned.nlink() != 1 {
                    return Err(invalid());
                }
                Some((file, owned))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        files.push((name, owned));
    }

    let mut deleted = false;
    let result = (|| {
        for (name, owned) in files {
            context.check()?;
            assert_location(&roots.backup_path, &roots.backup)?;
            assert_location(&roots.storage_path, &roots.storage)?;
            let current = match roots.backup.symlink_metadata(name) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            let Some((file, metadata)) = owned else {
                // A name absent during validation is never owned by this call.
                return Err(invalid());
            };
            if !current.is_file()
                || current.is_symlink()
                || current.nlink() != 1
                || !same(&metadata, &current)
                || !same(&metadata, &file.metadata()?)
            {
                return Err(invalid());
            }
            // Windows read handles deny delete sharing. Keep the inode pinned
            // until the final identity check, then unlink relative to its root.
            #[cfg(windows)]
            drop(file);
            roots.backup.remove_file(name)?;
            deleted = true;
            #[cfg(not(windows))]
            drop(file);
            sync_dir(&roots.backup)?;
            assert_location(&roots.backup_path, &roots.backup)?;
            assert_location(&roots.storage_path, &roots.storage)?;
            match roots.backup.symlink_metadata(name) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.into()),
                Ok(_) => return Err(invalid()),
            }
        }
        context.check()?;
        assert_location(&roots.backup_path, &roots.backup)?;
        assert_location(&roots.storage_path, &roots.storage)?;
        Ok(super::super::success())
    })();
    result.map_err(|error: CoreError| {
        if deleted {
            CoreError::new(
                "CORE_OPERATION_UNCERTAIN",
                "Die Löschung der Backup-Dateien konnte nicht vollständig bestätigt werden.",
            )
        } else {
            error
        }
    })
}

fn invalid_name() -> CoreError {
    CoreError::new("BACKUP_INVALID_NAME", "Ungültiger Backup-Dateiname.")
}
