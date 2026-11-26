use super::{MAX_CONTENT, MAX_ENTRIES, files, invalid, tar, text};
use crate::protocol::{CoreResult, OperationContext};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::{collections::HashSet, fs};

fn resolve(path: &Path) -> CoreResult<PathBuf> {
    match fs::canonicalize(path) {
        Ok(path) => Ok(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(resolve(
            path.parent()
                .ok_or_else(|| invalid("Der Storage-Pfad ist ungültig."))?,
        )?
        .join(
            path.file_name()
                .ok_or_else(|| invalid("Der Storage-Pfad ist ungültig."))?,
        )),
        Err(error) => Err(error.into()),
    }
}
fn inside(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        let left = left.to_string_lossy().to_uppercase();
        let right = right.to_string_lossy().to_uppercase();
        right == left
            || right
                .strip_prefix(&left)
                .is_some_and(|tail| tail.starts_with(['\\', '/']))
    }
    #[cfg(not(windows))]
    {
        right.starts_with(left)
    }
}
fn directory(path: &Path) -> CoreResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_dir() || meta.file_type().is_symlink() {
                return Err(invalid("Das Background-Storage-Verzeichnis ist unsicher."));
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(invalid("Das Background-Storage-Verzeichnis ist unsicher."));
                }
            }
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}
fn relative(value: &str) -> CoreResult<PathBuf> {
    let value = value.replace('\\', "/");
    tar::validate_entry(&format!("storage/{value}"), 0, "directory")?;
    Ok(value.split('/').collect())
}
fn collect(request: &Value, context: &OperationContext) -> CoreResult<Vec<Value>> {
    let root = Path::new(text(request, "storageRoot")?);
    let layout = &request["layout"];
    let public = relative(text(layout, "publicRelativeDirectory")?)?;
    let private = relative(text(layout, "privateRelativeDirectory")?)?;
    let name = text(layout, "fileName")?;
    tar::validate_entry(&format!("storage/{name}"), 0, "file")?;
    if name.contains(['\\', '/']) {
        return Err(invalid("Der Background-Dateiname ist ungültig."));
    }
    let relative_directory = if request["location"] == "private" {
        &private
    } else {
        &public
    };
    if !directory(root)? {
        return Ok(Vec::new());
    }
    let mut path = root.to_owned();
    for segment in relative_directory.components() {
        path.push(segment.as_os_str());
        if !directory(&path)? {
            return Ok(Vec::new());
        }
    }
    let users_directory = crate::storage::files::open_absolute(&path, false)?;
    let mut users = Vec::new();
    for user in users_directory.entries()? {
        if users.len() >= MAX_ENTRIES {
            return Err(invalid("Der Background-Storage enthält zu viele Einträge."));
        }
        users.push(user?);
    }
    users.sort_by_key(|user| user.file_name());
    let mut entries = Vec::new();
    let mut paths = HashSet::new();
    let mut size = 0;
    for user in users {
        context.check()?;
        let user_path = path.join(user.file_name());
        let meta = fs::symlink_metadata(&user_path)?;
        if meta.file_type().is_symlink() {
            return Err(invalid("Das Background-Storage-Verzeichnis ist unsicher."));
        }
        if !meta.is_dir() {
            continue;
        }
        directory(&user_path)?;
        let absolute = user_path.join(name);
        let meta = match fs::symlink_metadata(&absolute) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if !files::safe_metadata(&meta) {
            return Err(invalid("Die Background-Storage-Datei ist unsicher."));
        }
        let user_name = user
            .file_name()
            .into_string()
            .map_err(|_| invalid("Der Benutzerpfad ist ungültig."))?;
        let public_path = public.join(&user_name).join(name);
        let private_path = private.join(&user_name).join(name);
        let archive = tar::validate_entry(
            &format!(
                "storage/{}",
                public_path.to_string_lossy().replace('\\', "/")
            ),
            meta.len(),
            "file",
        )?;
        if !paths.insert(archive.path.to_uppercase()) || meta.len() > MAX_CONTENT - size {
            return Err(invalid(
                "Der Background-Storage enthält kollidierende oder zu große Einträge.",
            ));
        }
        size += meta.len();
        let file = files::open_source(&absolute)?;
        let identity = files::identity(&file)?;
        entries.push(json!({"absolutePath":absolute,"publicRelativePath":public_path,"privateRelativePath":private_path,"size":meta.len(),"identity":{"dev":identity.dev.to_string(),"ino":identity.ino.to_string()}}));
    }
    Ok(entries)
}
pub(crate) fn execute(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    match text(request, "operation")? {
        "backgroundCollect" => Ok(serde_json::to_value(collect(request, context)?)?),
        "backgroundAssertRoots" => {
            let roots = [
                PathBuf::from(text(request, "storageRoot")?),
                PathBuf::from(text(request, "privateStorageRoot")?),
            ];
            let cwd = std::env::current_dir()?;
            let real_cwd = fs::canonicalize(&cwd)?;
            let real = [resolve(&roots[0])?, resolve(&roots[1])?];
            for (index, root) in roots.iter().enumerate() {
                if !root.is_absolute()
                    || root.parent().is_none()
                    || inside(root, &cwd)
                    || real[index].parent().is_none()
                    || inside(&real[index], &real_cwd)
                {
                    return Err(invalid("Der konfigurierte Storage-Pfad ist zu allgemein."));
                }
                for protected in request["protectedPaths"]
                    .as_array()
                    .ok_or_else(|| invalid("Die geschützten Pfade fehlen."))?
                {
                    let protected = Path::new(
                        protected
                            .as_str()
                            .ok_or_else(|| invalid("Ein geschützter Pfad ist ungültig."))?,
                    );
                    let resolved = resolve(protected)?;
                    if inside(root, protected)
                        || inside(protected, root)
                        || inside(&real[index], &resolved)
                        || inside(&resolved, &real[index])
                    {
                        return Err(invalid(
                            "Storage und geschützte Backup-Pfade überschneiden sich.",
                        ));
                    }
                }
            }
            if inside(&roots[0], &roots[1])
                || inside(&roots[1], &roots[0])
                || inside(&real[0], &real[1])
                || inside(&real[1], &real[0])
            {
                return Err(invalid(
                    "Öffentlicher und privater Storage überschneiden sich.",
                ));
            }
            Ok(Value::Null)
        }
        "backgroundPartition" => {
            let root = Path::new(text(request, "restoreDirectory")?);
            if !directory(root)? {
                return Err(invalid("Das Restore-Verzeichnis fehlt."));
            }
            let destination = root.join("private-backgrounds");
            fs::create_dir(&destination)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&destination, fs::Permissions::from_mode(0o700))?;
            }
            let collect_request = json!({"storageRoot":root.join("storage"),"location":"public","layout":request["layout"]});
            let entries = collect(&collect_request, context)?;
            let source_root = crate::storage::files::open_absolute(&root.join("storage"), false)?;
            let target_root = crate::storage::files::open_absolute(&destination, false)?;
            for entry in &entries {
                context.check()?;
                let from = Path::new(text(entry, "publicRelativePath")?);
                let to = Path::new(text(entry, "privateRelativePath")?);
                let parent = to
                    .parent()
                    .ok_or_else(|| invalid("Der Background-Zielpfad ist ungültig."))?;
                crate::storage::files::descend(
                    &target_root,
                    parent,
                    true,
                    crate::storage::files::DirectoryPermissions::Private,
                )?;
                source_root.rename(from, &target_root, to)?;
                sync_directory(
                    &root
                        .join("storage")
                        .join(from.parent().unwrap_or(Path::new(""))),
                )?;
                sync_directory(&destination.join(parent))?;
            }
            sync_directory(&destination)?;
            sync_directory(root)?;
            Ok(
                json!({"restoredStoragePath":destination,"relativeFilePaths":entries.iter().map(|entry|entry["privateRelativePath"].clone()).collect::<Vec<_>>()}),
            )
        }
        _ => Err(invalid("Der Background-Auftrag ist ungültig.")),
    }
}
fn sync_directory(path: &Path) -> CoreResult<()> {
    #[cfg(unix)]
    {
        fs::File::open(path)?.sync_all()?;
    }
    #[cfg(windows)]
    {
        let _ = path;
    }
    Ok(())
}
