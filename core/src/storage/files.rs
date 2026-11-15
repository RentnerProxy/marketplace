use super::{invalid, string, success};
use crate::protocol::{CoreResult, OperationContext};
use base64::{Engine, engine::general_purpose::STANDARD};
use cap_fs_ext::{DirExt, FollowSymlinks, MetadataExt, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, File, Metadata, OpenOptions},
};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use zeroize::Zeroizing;

pub(crate) const MAX_IMAGE: u64 = 8 * 1024 * 1024;

pub(crate) fn absolute(path: &str) -> CoreResult<PathBuf> {
    let path = Path::new(path);
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                if !result.pop() {
                    return Err(invalid());
                }
            }
            Component::CurDir => (),
            Component::Normal(name) => {
                #[cfg(windows)]
                {
                    let name = name.to_str().ok_or_else(invalid)?;
                    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
                    if name.ends_with(['.', ' '])
                        || name.chars().any(|c| c < ' ' || ":<>\"|?*".contains(c))
                        || ["con", "prn", "aux", "nul"].contains(&stem.as_str())
                        || (stem.len() == 4
                            && (stem.starts_with("com") || stem.starts_with("lpt"))
                            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
                    {
                        return Err(invalid());
                    }
                }
                result.push(name);
            }
            other => result.push(other.as_os_str()),
        }
    }
    Ok(result)
}

pub(crate) fn relative(root: &Path, target: &Path, allow_root: bool) -> CoreResult<PathBuf> {
    if root.parent().is_none() {
        return Err(invalid());
    }
    let relative = target.strip_prefix(root).map_err(|_| invalid())?;
    if (!allow_root && relative.as_os_str().is_empty())
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(invalid());
    }
    Ok(relative.to_owned())
}

pub(crate) fn identity(metadata: &Metadata) -> CoreResult<Value> {
    if metadata.ino() == 0 {
        return Err(invalid());
    }
    Ok(json!({"dev": metadata.dev().to_string(), "ino": metadata.ino().to_string()}))
}
pub(crate) fn same(left: &Metadata, right: &Metadata) -> bool {
    left.dev() == right.dev() && left.ino() != 0 && left.ino() == right.ino()
}

/// Confirm that the configured name still denotes the opened directory. The
/// following mutation uses the pinned handle rather than resolving that name
/// again, so a replacement cannot redirect it to an unrelated directory.
pub(crate) fn assert_location(path: &Path, dir: &Dir) -> CoreResult<()> {
    if !same(
        &dir.dir_metadata()?,
        &open_absolute(path, false)?.dir_metadata()?,
    ) {
        return Err(invalid());
    }
    Ok(())
}

pub(crate) fn secure_directory(dir: &Dir) -> CoreResult<()> {
    #[cfg(unix)]
    {
        use cap_std::fs::PermissionsExt;
        // `.` is resolved against the pinned directory; unlike opening it for
        // reading first this also repairs an owned directory with mode 000.
        dir.set_permissions(".", cap_std::fs::Permissions::from_mode(0o700))?;
    }
    let metadata = dir.dir_metadata()?;
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        if metadata.mode() & 0o7777 != 0o700 {
            return Err(invalid());
        }
    }
    if !metadata.is_dir() {
        return Err(invalid());
    }
    Ok(())
}
#[allow(unused_mut)]
pub(crate) fn create_directory(dir: &Dir, name: &Path) -> std::io::Result<()> {
    let mut builder = cap_std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use cap_std::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    dir.create_dir_with(name, &builder)
}
pub(crate) fn secure_file(file: &File) -> CoreResult<()> {
    #[cfg(unix)]
    {
        use cap_std::fs::PermissionsExt;
        file.set_permissions(cap_std::fs::Permissions::from_mode(0o600))?;
    }
    let metadata = file.metadata()?;
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        if metadata.mode() & 0o7777 != 0o600 {
            return Err(invalid());
        }
    }
    if !metadata.is_file() {
        return Err(invalid());
    }
    Ok(())
}
pub(crate) fn sync_dir(dir: &Dir) -> CoreResult<()> {
    #[cfg(not(windows))]
    dir.open(".")?.sync_all()?;
    #[cfg(windows)]
    let _ = dir;
    Ok(())
}

// Walk each absolute component without following symlinks/junctions. Handles
// remain authoritative if a directory is renamed after it has been opened.
pub(crate) fn open_absolute(path: &Path, create: bool) -> CoreResult<Dir> {
    let mut parts = path.components();
    let mut anchor = PathBuf::new();
    for part in parts.by_ref() {
        anchor.push(part.as_os_str());
        if matches!(part, Component::RootDir) {
            break;
        }
    }
    let mut dir = Dir::open_ambient_dir(anchor, ambient_authority())?;
    for part in parts {
        let Component::Normal(name) = part else {
            return Err(invalid());
        };
        dir = match dir.open_dir_nofollow(name) {
            Ok(child) => child,
            Err(error) if create && error.kind() == std::io::ErrorKind::NotFound => {
                match create_directory(&dir, Path::new(name)) {
                    Ok(()) => (),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
                    Err(error) => return Err(error.into()),
                }
                dir.open_dir_nofollow(name)?
            }
            Err(error) => return Err(error.into()),
        };
    }
    Ok(dir)
}

pub(crate) fn descend(root: &Dir, relative: &Path, create: bool, secure: bool) -> CoreResult<Dir> {
    let mut dir = root.try_clone()?;
    for part in relative.components() {
        let Component::Normal(name) = part else {
            return Err(invalid());
        };
        dir = match dir.open_dir_nofollow(name) {
            Ok(child) => child,
            Err(error) if create && error.kind() == std::io::ErrorKind::NotFound => {
                match create_directory(&dir, Path::new(name)) {
                    Ok(()) => (),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
                    Err(error) => return Err(error.into()),
                }
                dir.open_dir_nofollow(name)?
            }
            Err(error) => return Err(error.into()),
        };
        if secure {
            secure_directory(&dir)?;
        }
    }
    Ok(dir)
}
pub(crate) fn parent(path: &Path, create: bool) -> CoreResult<(Dir, OsString)> {
    Ok((
        open_absolute(path.parent().ok_or_else(invalid)?, create)?,
        path.file_name().ok_or_else(invalid)?.to_owned(),
    ))
}
pub(crate) fn open_read(dir: &Dir, name: &Path) -> CoreResult<File> {
    open_checked(dir, name, false)
}

pub(crate) fn open_sync(dir: &Dir, name: &Path) -> CoreResult<File> {
    open_checked(dir, name, true)
}

fn open_checked(dir: &Dir, name: &Path, writable: bool) -> CoreResult<File> {
    let before = dir.symlink_metadata(name)?;
    if !before.is_file() || before.is_symlink() {
        return Err(invalid());
    }
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(writable)
        .follow(FollowSymlinks::No)
        .nonblock(true);
    let file = dir.open_with(name, &options)?;
    if !same(&before, &file.metadata()?) {
        return Err(invalid());
    }
    Ok(file)
}
pub(crate) fn create_file(dir: &Dir, name: &Path) -> CoreResult<File> {
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = dir.open_with(name, &options)?;
    secure_file(&file)?;
    Ok(file)
}

pub(crate) fn prepare(request: &Value) -> CoreResult<Value> {
    let root = absolute(string(request, "rootDirectory")?)?;
    let target = absolute(string(request, "directoryPath")?)?;
    let relative = relative(&root, &target, true)?;
    let mut dir = open_absolute(&root, true)?;
    secure_directory(&dir)?;
    let mut current = root;
    let mut snapshots = vec![json!({"path": current, "identity": identity(&dir.dir_metadata()?)?})];
    for part in relative.components() {
        dir = descend(&dir, Path::new(part.as_os_str()), true, true)?;
        current.push(part.as_os_str());
        snapshots.push(json!({"path": current, "identity": identity(&dir.dir_metadata()?)?}));
    }
    Ok(json!(snapshots))
}
pub(crate) fn assert_snapshots(request: &Value) -> CoreResult<Value> {
    for snapshot in request["directories"].as_array().ok_or_else(invalid)? {
        let dir = open_absolute(&absolute(string(snapshot, "path")?)?, false)?;
        let metadata = dir.dir_metadata()?;
        if identity(&metadata)? != snapshot["identity"] {
            return Err(invalid());
        }
        #[cfg(unix)]
        {
            use cap_std::fs::MetadataExt as _;
            if metadata.mode() & 0o7777 != 0o700 {
                return Err(invalid());
            }
        }
    }
    Ok(success())
}

pub(crate) fn write(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let data = zeroize::Zeroizing::new(
        STANDARD
            .decode(request["dataBase64"].as_str().ok_or_else(invalid)?)
            .map_err(|_| invalid())?,
    );
    write_bytes(request, &data, context)
}

pub(crate) fn write_bytes(
    request: &Value,
    data: &[u8],
    context: &OperationContext,
) -> CoreResult<Value> {
    if data.len() as u64 > MAX_IMAGE {
        return Err(invalid());
    }
    let root = absolute(string(request, "rootDirectory")?)?;
    let target = absolute(string(request, "filePath")?)?;
    let rel = relative(&root, &target, false)?;
    let root_dir = open_absolute(&root, true)?;
    secure_directory(&root_dir)?;
    let dir = descend(&root_dir, rel.parent().unwrap_or(Path::new("")), true, true)?;
    let name = rel.file_name().ok_or_else(invalid)?;
    let directory_path = target.parent().ok_or_else(invalid)?;
    let temp = format!(".private-file-{}.tmp", uuid::Uuid::new_v4());
    let mut file = create_file(&dir, Path::new(&temp))?;
    let owned = file.metadata()?;
    let result = (|| {
        context.check()?;
        assert_location(&root, &root_dir)?;
        // An empty descent clones root_dir, so this is the same pinned directory.
        if directory_path != root {
            assert_location(directory_path, &dir)?;
        }
        file.write_all(data)?;
        file.sync_all()?;
        if !same(&owned, &dir.symlink_metadata(&temp)?) {
            return Err(invalid());
        }
        context.check()?;
        assert_location(&root, &root_dir)?;
        if directory_path != root {
            assert_location(directory_path, &dir)?;
        }
        drop(file);
        dir.rename(&temp, &dir, name)?;
        sync_dir(&dir)?;
        Ok(success())
    })();
    if result.is_err()
        && assert_location(directory_path, &dir).is_ok()
        && dir
            .symlink_metadata(&temp)
            .is_ok_and(|actual| same(&actual, &owned))
    {
        let _ = dir.remove_file(&temp);
    }
    result
}

fn read_path_bytes(
    path: &Path,
    context: &OperationContext,
) -> CoreResult<Option<Zeroizing<Vec<u8>>>> {
    let (dir, name) = match parent(path, false) {
        Ok(parent) => parent,
        Err(error) if error.code == "ENOENT" => return Ok(None),
        Err(error) => return Err(error),
    };
    let file = match open_read(&dir, Path::new(&name)) {
        Ok(file) => file,
        Err(error) if error.code == "ENOENT" => return Ok(None),
        Err(error) => return Err(error),
    };
    secure_file(&file)?;
    let before = file.metadata()?;
    if before.len() > MAX_IMAGE {
        return Err(invalid());
    }
    let mut data = Zeroizing::new(Vec::new());
    (&file).take(MAX_IMAGE + 1).read_to_end(&mut data)?;
    let after = file.metadata()?;
    context.check()?;
    if data.len() as u64 != before.len()
        || data.len() as u64 > MAX_IMAGE
        || !same(&before, &after)
        || before.len() != after.len()
        || before.modified()? != after.modified()?
    {
        return Err(invalid());
    }
    Ok(Some(data))
}

fn encoded_file(data: Option<Zeroizing<Vec<u8>>>) -> Value {
    data.map_or(
        Value::Null,
        |data| json!({"dataBase64": STANDARD.encode(data.as_slice())}),
    )
}
pub(crate) fn read(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let root = absolute(string(request, "rootDirectory")?)?;
    let path = absolute(string(request, "filePath")?)?;
    relative(&root, &path, false)?;
    Ok(encoded_file(read_path_bytes(&path, context)?))
}
pub(crate) fn read_background(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    Ok(encoded_file(read_background_bytes(request, context)?))
}

pub(crate) fn read_background_bytes(
    request: &Value,
    context: &OperationContext,
) -> CoreResult<Option<Zeroizing<Vec<u8>>>> {
    prepare(
        &json!({"rootDirectory":request["rootDirectory"],"directoryPath":request["directoryPath"]}),
    )?;
    let path = absolute(string(request, "filePath")?)?;
    relative(&absolute(string(request, "rootDirectory")?)?, &path, false)?;
    if let Some(current) = read_path_bytes(&path, context)? {
        return Ok(Some(current));
    }
    let legacy = absolute(string(request, "legacyPath")?)?;
    let legacy_root = absolute(string(request, "legacyRoot")?)?;
    relative(&legacy_root, &legacy, false)?;
    let (source, name) = match parent(&legacy, false) {
        Ok(parent) => parent,
        Err(error) if error.code == "ENOENT" => return Ok(None),
        Err(error) => return Err(error),
    };
    let file = match open_read(&source, Path::new(&name)) {
        Ok(file) => file,
        Err(error) if error.code == "ENOENT" => return Ok(None),
        Err(error) => return Err(error),
    };
    secure_file(&file)?;
    let owned = file.metadata()?;
    if owned.len() > MAX_IMAGE {
        return Err(invalid());
    }
    // Windows no-delete-sharing read handles must be closed before the link
    // publication/unlink sequence; path identities are checked again below.
    drop(file);
    let (destination, dest_name) = parent(&path, false)?;
    if !same(&owned, &source.symlink_metadata(&name)?) {
        return Err(invalid());
    }
    match source.hard_link(&name, &destination, &dest_name) {
        Ok(()) => (),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::NotFound
            ) =>
        {
            return read_path_bytes(&path, context);
        }
        Err(error) => return Err(error.into()),
    }
    if !same(&owned, &destination.symlink_metadata(&dest_name)?) {
        return Err(invalid());
    }
    sync_dir(&destination)?;
    if source
        .symlink_metadata(&name)
        .is_ok_and(|actual| same(&actual, &owned))
    {
        source.remove_file(&name)?;
        sync_dir(&source)?;
    }
    read_path_bytes(&path, context)
}

pub(crate) fn utility(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let path = absolute(string(request, "path")?)?;
    match string(request, "operation")? {
        "syncDirectory" => sync_dir(&open_absolute(&path, false)?)?,
        "syncFile" => {
            let (dir, name) = parent(&path, false)?;
            open_sync(&dir, Path::new(&name))?.sync_all()?;
        }
        "rename" => {
            let (source, name) = parent(&path, false)?;
            let target = absolute(string(request, "destination")?)?;
            let (destination, target_name) = parent(&target, false)?;
            super::recovery::rename_retry(
                &source,
                Path::new(&name),
                &destination,
                Path::new(&target_name),
                context,
            )?;
        }
        "remove" => {
            let (dir, name) = match parent(&path, false) {
                Ok(parent) => parent,
                Err(error) if error.code == "ENOENT" => return Ok(success()),
                Err(error) => return Err(error),
            };
            super::recovery::remove(&dir, Path::new(&name))?;
            sync_dir(&dir)?;
        }
        "tempDirectory" => {
            let dir = open_absolute(&path, false)?;
            let prefix = string(request, "prefix")?;
            if prefix.contains(['/', '\\']) || prefix.len() > 128 {
                return Err(invalid());
            }
            let name = format!("{}{}", prefix, uuid::Uuid::new_v4());
            create_directory(&dir, Path::new(&name))?;
            secure_directory(&dir.open_dir_nofollow(&name)?)?;
            sync_dir(&dir)?;
            return Ok(json!(path.join(name)));
        }
        "permissions" => {
            let dir = open_absolute(&path, true)?;
            let name = format!(".restore-permission-check-{}", uuid::Uuid::new_v4());
            create_directory(&dir, Path::new(&name))?;
            let result = (|| {
                let child = dir.open_dir_nofollow(&name)?;
                secure_directory(&child)?;
                let mut file = create_file(&child, Path::new("write"))?;
                file.write_all(b"restore-permission-check")?;
                file.sync_all()?;
                drop(file);
                child.rename("write", &child, "rename")?;
                let target = format!("{name}.renamed");
                drop(child);
                dir.rename(&name, &dir, &target)?;
                dir.remove_dir_all(&target)?;
                sync_dir(&dir)
            })();
            if result.is_err() {
                let _ = dir.remove_dir_all(&name);
            }
            result?;
        }
        _ => return Err(invalid()),
    }
    Ok(success())
}

#[cfg(test)]
#[path = "../../tests/unit/storage_files.rs"]
mod tests;
