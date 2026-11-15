use super::{files::*, invalid, string, success};
use crate::protocol::{CoreError, CoreResult, OperationContext};
use cap_fs_ext::DirExt;
use cap_fs_ext::MetadataExt;
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::Dir;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

const MAX_ENTRIES: usize = 100_000;
const MAX_BYTES: u64 = 25 * 1024 * 1024 * 1024;
const RETRIES: [u64; 7] = [100, 200, 400, 800, 1200, 1600, 2000];

pub(super) fn remove(dir: &Dir, name: &Path) -> CoreResult<()> {
    let mut owned = None;
    for delay in RETRIES.into_iter().map(Some).chain(std::iter::once(None)) {
        let stats = match dir.symlink_metadata(name) {
            Ok(stats) => stats,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        if stats.is_symlink() || (!stats.is_file() && !stats.is_dir()) {
            return Err(invalid());
        }
        let current = identity(&stats)?;
        if owned.as_ref().is_some_and(|expected| *expected != current) {
            return Err(invalid());
        }
        owned = Some(current);
        let result = if stats.is_dir() {
            dir.remove_dir_all(name)
        } else {
            dir.remove_file(name)
        };
        match result {
            Ok(()) => return Ok(()),
            Err(error)
                if delay.is_some()
                    && (error.kind() == std::io::ErrorKind::PermissionDenied
                        || matches!(error.raw_os_error(), Some(16 | 32 | 33))) =>
            {
                std::thread::sleep(Duration::from_millis(delay.unwrap_or(0)))
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(invalid())
}

pub(super) fn rename_retry(
    source: &Dir,
    name: &Path,
    target: &Dir,
    destination: &Path,
    context: &OperationContext,
) -> CoreResult<()> {
    for retry_delay in RETRIES.into_iter().map(Some).chain(std::iter::once(None)) {
        context.check()?;
        match source.rename(name, target, destination) {
            Ok(()) => return Ok(()),
            Err(error)
                if retry_delay.is_some()
                    && (error.kind() == std::io::ErrorKind::PermissionDenied
                        || matches!(error.raw_os_error(), Some(16 | 32 | 33))) =>
            {
                let mut remaining = retry_delay.unwrap_or(0);
                while remaining > 0 {
                    context.check()?;
                    let delay = remaining.min(50);
                    std::thread::sleep(Duration::from_millis(delay));
                    remaining -= delay;
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(invalid())
}

fn names(dir: &Dir) -> CoreResult<Vec<String>> {
    let mut entries = Vec::new();
    for entry in dir.entries()? {
        let name = entry?.file_name().into_string().map_err(|_| invalid())?;
        if entries.len() >= MAX_ENTRIES {
            return Err(invalid());
        }
        entries.push(name);
    }
    entries.sort();
    Ok(entries)
}

struct WalkFrame {
    directory: Dir,
    entries: cap_std::fs::ReadDir,
}
fn walk_frame(directory: Dir) -> CoreResult<WalkFrame> {
    let entries = directory.entries()?;
    Ok(WalkFrame { directory, entries })
}

fn sync_tree(dir: &Dir, context: &OperationContext, entries: &mut usize) -> CoreResult<()> {
    let mut frames = vec![walk_frame(dir.try_clone()?)?];
    while let Some(frame) = frames.last_mut() {
        context.check()?;
        let Some(entry) = frame.entries.next() else {
            sync_dir(&frame.directory)?;
            frames.pop();
            continue;
        };
        let name = entry?.file_name();
        *entries += 1;
        if *entries > MAX_ENTRIES {
            return Err(invalid());
        }
        let metadata = frame.directory.symlink_metadata(&name)?;
        if metadata.is_symlink() {
            return Err(invalid());
        }
        if metadata.is_dir() {
            let child = frame.directory.open_dir_nofollow(&name)?;
            if !same(&metadata, &child.dir_metadata()?) {
                return Err(invalid());
            }
            frames.push(walk_frame(child)?);
        } else if metadata.is_file() {
            open_sync(&frame.directory, Path::new(&name))?.sync_all()?;
        } else {
            return Err(invalid());
        }
    }
    Ok(())
}
pub(super) fn sync_tree_path(path: &str, context: &OperationContext) -> CoreResult<()> {
    sync_tree(&open_absolute(&absolute(path)?, false)?, context, &mut 0)
}

struct CopyFrame {
    source: Dir,
    destination: Dir,
    entries: cap_std::fs::ReadDir,
}

fn copy(
    source: &Dir,
    name: &Path,
    destination: &Dir,
    target: &Path,
    context: &OperationContext,
    entries: &mut usize,
    bytes: &mut u64,
) -> CoreResult<()> {
    let mut frames = Vec::new();
    if let Some(frame) = copy_entry(source, name, destination, target, context, entries, bytes)? {
        frames.push(frame);
    }
    while let Some(frame) = frames.last_mut() {
        context.check()?;
        let Some(entry) = frame.entries.next() else {
            sync_dir(&frame.destination)?;
            frames.pop();
            continue;
        };
        let name = entry?.file_name();
        if let Some(child) = copy_entry(
            &frame.source,
            Path::new(&name),
            &frame.destination,
            Path::new(&name),
            context,
            entries,
            bytes,
        )? {
            frames.push(child);
        }
    }
    sync_dir(destination)
}

fn copy_entry(
    source: &Dir,
    name: &Path,
    destination: &Dir,
    target: &Path,
    context: &OperationContext,
    entries: &mut usize,
    bytes: &mut u64,
) -> CoreResult<Option<CopyFrame>> {
    context.check()?;
    *entries += 1;
    if *entries > MAX_ENTRIES {
        return Err(invalid());
    }
    let before = source.symlink_metadata(name)?;
    if before.is_symlink() {
        return Err(invalid());
    }
    if before.is_file() {
        *bytes = bytes.checked_add(before.len()).ok_or_else(invalid)?;
        if *bytes > MAX_BYTES {
            return Err(invalid());
        }
        let mut input = open_read(source, name)?;
        let mut output = create_file(destination, target)?;
        let mut copied = 0u64;
        let mut buffer = vec![0u8; 128 * 1024];
        loop {
            context.check()?;
            let count = input.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            copied += count as u64;
            if copied > before.len() {
                return Err(invalid());
            }
            output.write_all(&buffer[..count])?;
        }
        let after = input.metadata()?;
        if copied != before.len()
            || !same(&before, &after)
            || before.len() != after.len()
            || before.modified()? != after.modified()?
        {
            return Err(invalid());
        }
        output.sync_all()?;
        sync_dir(destination)?;
        Ok(None)
    } else if before.is_dir() {
        let child = source.open_dir_nofollow(name)?;
        if !same(&before, &child.dir_metadata()?) {
            return Err(invalid());
        }
        create_directory(destination, target)?;
        let out = destination.open_dir_nofollow(target)?;
        secure_directory(&out)?;
        let entries = child.entries()?;
        Ok(Some(CopyFrame {
            source: child,
            destination: out,
            entries,
        }))
    } else {
        Err(invalid())
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnedEntry {
    name: String,
    identity: Value,
    parent_identity: Value,
    #[serde(default)]
    original_parent_identity: Option<Value>,
    #[serde(default)]
    original_identity: Option<Value>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Journal {
    token: String,
    storage_root: PathBuf,
    root_identity: Value,
    recovery_identity: Value,
    moved: Vec<OwnedEntry>,
    installed: Vec<OwnedEntry>,
    #[serde(skip)]
    persisted_moved: usize,
    #[serde(skip)]
    persisted_installed: usize,
    #[serde(skip)]
    journal_bytes: usize,
    #[serde(skip)]
    journal_identity: Option<Value>,
}
fn entry_parent(root: &Dir, name: &str, create: bool) -> CoreResult<(Dir, PathBuf)> {
    let path = Path::new(name);
    if path
        .components()
        .any(|part| !matches!(part, std::path::Component::Normal(_)))
        || path.as_os_str().is_empty()
    {
        return Err(invalid());
    }
    Ok((
        descend(root, path.parent().unwrap_or(Path::new("")), create, true)?,
        PathBuf::from(path.file_name().ok_or_else(invalid)?),
    ))
}
fn persist(dir: &Dir, journal: &mut Journal) -> CoreResult<()> {
    let name = format!(".native-state-{}.json", journal.token);
    if journal.journal_bytes == 0 {
        let mut data = serde_json::to_vec(journal)?;
        data.push(b'\n');
        if data.len() > 32 * 1024 * 1024 {
            return Err(invalid());
        }
        let mut file = create_file(dir, Path::new(&name))?;
        journal.journal_identity = Some(identity(&file.metadata()?)?);
        file.write_all(&data)?;
        file.sync_all()?;
        sync_dir(dir)?;
        journal.journal_bytes = data.len();
    } else {
        let mut data = Vec::new();
        for (kind, entries, start) in [
            ("moved", &journal.moved, journal.persisted_moved),
            ("installed", &journal.installed, journal.persisted_installed),
        ] {
            for (index, entry) in entries.iter().enumerate().skip(start) {
                serde_json::to_writer(
                    &mut data,
                    &json!({"kind":kind,"index":index,"entry":entry}),
                )?;
                data.push(b'\n');
            }
        }
        if journal
            .journal_bytes
            .checked_add(data.len())
            .is_none_or(|size| size > 32 * 1024 * 1024)
        {
            return Err(invalid());
        }
        let before = dir.symlink_metadata(&name)?;
        if !before.is_file()
            || before.is_symlink()
            || before.nlink() != 1
            || before.len() != journal.journal_bytes as u64
            || journal.journal_identity.as_ref() != Some(&identity(&before)?)
        {
            return Err(invalid());
        }
        let mut options = cap_std::fs::OpenOptions::new();
        options.append(true).follow(FollowSymlinks::No);
        let mut file = dir.open_with(&name, &options)?;
        if !same(&before, &file.metadata()?) {
            return Err(invalid());
        }
        file.write_all(&data)?;
        file.sync_all()?;
        journal.journal_bytes += data.len();
    }
    journal.persisted_moved = journal.moved.len();
    journal.persisted_installed = journal.installed.len();
    Ok(())
}

fn replay(data: &[u8]) -> CoreResult<Journal> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Event {
        kind: String,
        index: usize,
        entry: OwnedEntry,
    }
    if !data.ends_with(b"\n") {
        return Err(invalid());
    }
    let mut lines = data.split(|byte| *byte == b'\n');
    let mut journal: Journal = serde_json::from_slice(lines.next().ok_or_else(invalid)?)?;
    if journal.moved.len() + journal.installed.len() > MAX_ENTRIES {
        return Err(invalid());
    }
    for line in lines.filter(|line| !line.is_empty()) {
        let event: Event = serde_json::from_slice(line)?;
        let entries = match event.kind.as_str() {
            "moved" => &mut journal.moved,
            "installed" => &mut journal.installed,
            _ => return Err(invalid()),
        };
        if event.index == entries.len() {
            entries.push(event.entry);
        } else if event.kind == "moved" && event.index + 1 == entries.len() {
            entries[event.index] = event.entry;
        } else {
            return Err(invalid());
        }
        if journal.moved.len() + journal.installed.len() > MAX_ENTRIES {
            return Err(invalid());
        }
    }
    journal.journal_bytes = data.len();
    journal.persisted_moved = journal.moved.len();
    journal.persisted_installed = journal.installed.len();
    Ok(journal)
}
fn assert_owned(root: &Dir, entry: &OwnedEntry) -> CoreResult<(Dir, PathBuf)> {
    let (dir, name) = entry_parent(root, &entry.name, false)?;
    if identity(&dir.dir_metadata()?)? != entry.parent_identity
        || identity(&dir.symlink_metadata(&name)?)? != entry.identity
    {
        return Err(invalid());
    }
    Ok((dir, name))
}
fn move_entry(
    source: &Dir,
    name: &Path,
    target: &Dir,
    dest: &Path,
    context: &OperationContext,
) -> CoreResult<()> {
    // Exclusive destination is required; recovery directories are freshly owned.
    if target.symlink_metadata(dest).is_ok() {
        return Err(CoreError::new(
            "EEXIST",
            "Der Recovery-Zielpfad ist bereits belegt.",
        ));
    }
    match rename_retry(source, name, target, dest, context) {
        Ok(()) => (),
        Err(error) if matches!(error.code.as_str(), "CORE_IO_ERROR" | "EACCES") => {
            if let Err(error) = copy(source, name, target, dest, context, &mut 0, &mut 0) {
                let _ = remove(target, dest);
                return Err(error);
            }
            remove(source, name)?;
        }
        Err(error) => return Err(error),
    }
    sync_dir(source)?;
    sync_dir(target)
}
fn rollback(root: &Dir, recovery: &Dir, journal: &Journal) -> CoreResult<()> {
    let context = OperationContext::cleanup();
    // A failed rollback retains its complete journal and recovery data.
    for entry in journal.installed.iter().rev() {
        let (dir, name) = entry_parent(root, &entry.name, false)?;
        match dir.symlink_metadata(&name) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            _ => {
                let (dir, name) = assert_owned(root, entry)?;
                remove(&dir, &name)?;
                sync_dir(&dir)?;
            }
        }
    }
    for entry in journal.moved.iter().rev() {
        let (source, name) = entry_parent(recovery, &entry.name, false)?;
        if let Err(error) = source.symlink_metadata(&name) {
            if error.kind() == std::io::ErrorKind::NotFound {
                let (destination, target) = entry_parent(root, &entry.name, false)?;
                if identity(&destination.symlink_metadata(target)?)?
                    == *entry.original_identity.as_ref().unwrap_or(&entry.identity)
                {
                    continue;
                }
            }
            return Err(error.into());
        }
        let (source, name) = assert_owned(recovery, entry)?;
        let (destination, target) = entry_parent(root, &entry.name, true)?;
        if let Some(expected) = &entry.original_parent_identity
            && identity(&destination.dir_metadata()?)? != *expected
        {
            return Err(invalid());
        }
        // Never delete a concurrently replaced destination during rollback.
        if let Ok(current) = destination.symlink_metadata(&target) {
            if entry
                .original_identity
                .as_ref()
                .is_some_and(|expected| identity(&current).is_ok_and(|actual| actual == *expected))
            {
                remove(&destination, &target)?;
            } else {
                return Err(invalid());
            }
        }
        move_entry(&source, &name, &destination, &target, &context)?;
    }
    sync_dir(root)
}

pub(super) fn prepare(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let root_path = absolute(string(request, "storageRoot")?)?;
    if root_path.parent().is_none() {
        return Err(invalid());
    }
    let root = open_absolute(&root_path, false)?;
    let source_path = absolute(string(request, "restoredStoragePath")?)?;
    if source_path.starts_with(&root_path) || root_path.starts_with(&source_path) {
        return Err(invalid());
    }
    let source = open_absolute(&source_path, false)?;
    let private = request["private"].as_bool().unwrap_or(false);
    if private {
        secure_directory(&root)?;
    }
    let complete = request["completeSnapshot"].as_bool().unwrap_or(true);
    let originals = if private {
        if complete {
            request["originalEntries"]
                .as_array()
                .ok_or_else(invalid)?
                .iter()
                .map(|entry| string(entry, "privateRelativePath").map(str::to_owned))
                .collect::<CoreResult<Vec<_>>>()?
        } else {
            Vec::new()
        }
    } else {
        names(&root)?
    };
    let restored = if private {
        request["restoredRelativeFilePaths"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .map(|entry| entry.as_str().map(str::to_owned).ok_or_else(invalid))
            .collect::<CoreResult<Vec<_>>>()?
    } else {
        names(&source)?
    };
    if originals.len() + restored.len() > MAX_ENTRIES {
        return Err(invalid());
    }
    let parent = open_absolute(root_path.parent().ok_or_else(invalid)?, false)?;
    let token = uuid::Uuid::new_v4().to_string();
    let recovery_name = format!(".storage-before-{token}");
    let recovery_path = root_path.parent().ok_or_else(invalid)?.join(&recovery_name);
    create_directory(&parent, Path::new(&recovery_name))?;
    let recovery = parent.open_dir_nofollow(&recovery_name)?;
    secure_directory(&recovery)?;
    let mut journal = Journal {
        token: token.clone(),
        storage_root: root_path.clone(),
        root_identity: identity(&root.dir_metadata()?)?,
        recovery_identity: identity(&recovery.dir_metadata()?)?,
        moved: Vec::new(),
        installed: Vec::new(),
        persisted_moved: 0,
        persisted_installed: 0,
        journal_bytes: 0,
        journal_identity: None,
    };
    if let Err(error) = persist(&recovery, &mut journal).and_then(|()| sync_dir(&parent)) {
        drop(recovery);
        if parent.remove_dir_all(&recovery_name).is_err() {
            return Err(CoreError::new(
                "STORAGE_ROLLBACK_FAILED",
                "Der private Recovery-Bereich konnte nicht sicher vorbereitet oder bereinigt werden.",
            ));
        }
        return Err(error);
    }
    let result = (|| {
        let total = originals.len() + restored.len();
        let mut processed = 0;
        for name in originals {
            context.check()?;
            assert_location(&root_path, &root)?;
            assert_location(&recovery_path, &recovery)?;
            let (from, base) = entry_parent(&root, &name, false)?;
            let metadata = from.symlink_metadata(&base)?;
            if metadata.is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
                return Err(invalid());
            }
            if private {
                let expected = request["originalEntries"]
                    .as_array()
                    .ok_or_else(invalid)?
                    .iter()
                    .find(|entry| entry["privateRelativePath"] == name)
                    .ok_or_else(invalid)?;
                if identity(&metadata)? != expected["identity"] || !metadata.is_file() {
                    return Err(invalid());
                }
            }
            let (to, dest) = entry_parent(&recovery, &name, true)?;
            // Record the rename intent before mutation. The fallback copies
            // through an exclusive private stage and persists its new identity
            // before deleting any original bytes (including partial removals).
            journal.moved.push(OwnedEntry {
                name: name.clone(),
                identity: identity(&metadata)?,
                parent_identity: identity(&to.dir_metadata()?)?,
                original_parent_identity: Some(identity(&from.dir_metadata()?)?),
                original_identity: Some(identity(&metadata)?),
            });
            persist(&recovery, &mut journal)?;
            if let Err(error) = rename_retry(&from, &base, &to, &dest, context) {
                if !matches!(error.code.as_str(), "CORE_IO_ERROR" | "EACCES") {
                    return Err(error);
                }
                let stage_name = format!(".original-copy-{}", uuid::Uuid::new_v4());
                create_directory(&recovery, Path::new(&stage_name))?;
                let stage = recovery.open_dir_nofollow(&stage_name)?;
                secure_directory(&stage)?;
                copy(
                    &from,
                    &base,
                    &stage,
                    Path::new("entry"),
                    context,
                    &mut 0,
                    &mut 0,
                )?;
                journal.moved.last_mut().ok_or_else(invalid)?.identity =
                    identity(&stage.symlink_metadata("entry")?)?;
                journal.persisted_moved = journal.moved.len() - 1;
                persist(&recovery, &mut journal)?;
                rename_retry(&stage, Path::new("entry"), &to, &dest, context)?;
                sync_dir(&to)?;
                remove(&from, &base)?;
                drop(stage);
                recovery.remove_dir(&stage_name)?;
            }
            sync_dir(&from)?;
            sync_dir(&to)?;
            processed += 1;
            context.progress(json!({"processedEntries":processed,"totalEntries":total}))?;
        }
        let mut copied_entries = 0;
        let mut copied_bytes = 0;
        for name in restored {
            context.check()?;
            assert_location(&root_path, &root)?;
            assert_location(&recovery_path, &recovery)?;
            assert_location(&source_path, &source)?;
            let (from, base) = entry_parent(&source, &name, false)?;
            if private {
                let metadata = from.symlink_metadata(&base)?;
                if !metadata.is_file()
                    || metadata.is_symlink()
                    || metadata.nlink() != 1
                    || metadata.len() > MAX_BYTES
                {
                    return Err(invalid());
                }
            }
            let (to, dest) = entry_parent(&root, &name, true)?;
            if private && !complete && to.symlink_metadata(&dest).is_ok() {
                continue;
            }
            if to.symlink_metadata(&dest).is_ok() {
                return Err(invalid());
            }
            // Complete and sync an exclusive copy in the private recovery area
            // first. Persist its identity before the publication rename, so a
            // cancellation or crash never publishes an unjournaled root entry.
            let stage_name = format!(".install-{}", uuid::Uuid::new_v4());
            create_directory(&recovery, Path::new(&stage_name))?;
            let stage = recovery.open_dir_nofollow(&stage_name)?;
            secure_directory(&stage)?;
            copy(
                &from,
                &base,
                &stage,
                Path::new("entry"),
                context,
                &mut copied_entries,
                &mut copied_bytes,
            )?;
            journal.installed.push(OwnedEntry {
                name: name.clone(),
                identity: identity(&stage.symlink_metadata("entry")?)?,
                parent_identity: identity(&to.dir_metadata()?)?,
                original_parent_identity: None,
                original_identity: None,
            });
            persist(&recovery, &mut journal)?;
            assert_location(&root_path, &root)?;
            assert_location(root_path.join(&name).parent().ok_or_else(invalid)?, &to)?;
            if private {
                // Private file publication must stay exclusive even if another
                // writer appears after the initial destination check. A hard
                // link publishes the fully synced inode without replacement.
                if let Err(error) = stage.hard_link("entry", &to, &dest) {
                    journal.installed.pop();
                    return Err(error.into());
                }
                let installed = journal.installed.last().ok_or_else(invalid)?;
                if identity(&to.symlink_metadata(&dest)?)? != installed.identity {
                    return Err(invalid());
                }
                sync_dir(&to)?;
                stage.remove_file("entry")?;
            } else {
                rename_retry(&stage, Path::new("entry"), &to, &dest, context)?;
            }
            sync_dir(&to)?;
            drop(stage);
            recovery.remove_dir(&stage_name)?;
            sync_dir(&recovery)?;
            processed += 1;
            context.progress(json!({"processedEntries":processed,"totalEntries":total}))?;
        }
        sync_dir(&root)?;
        sync_dir(&parent)?;
        Ok(())
    })();
    if let Err(error) = result {
        if assert_location(&root_path, &root)
            .and_then(|()| assert_location(&recovery_path, &recovery))
            .and_then(|()| rollback(&root, &recovery, &journal))
            .is_err()
        {
            return Err(CoreError::new(
                "STORAGE_ROLLBACK_FAILED",
                "Storage-Restore und Rollback sind fehlgeschlagen. Der Recovery-Ordner bleibt zur manuellen Rettung erhalten.",
            ));
        }
        drop(recovery);
        parent.remove_dir_all(&recovery_name)?;
        sync_dir(&parent)?;
        return Err(error);
    }
    Ok(
        json!({"recoveryDirectory":root_path.parent().ok_or_else(invalid)?.join(recovery_name),"token":token,"proof":{"root":journal.root_identity,"recovery":journal.recovery_identity,"journal":journal.journal_identity}}),
    )
}

pub(super) fn finish(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    let path = absolute(string(request, "recoveryDirectory")?)?;
    let token = string(request, "token")?;
    if uuid::Uuid::parse_str(token).is_err()
        || path.file_name().and_then(|name| name.to_str())
            != Some(format!(".storage-before-{token}").as_str())
    {
        return Err(invalid());
    }
    let (parent, name) = parent(&path, false)?;
    let recovery = parent.open_dir_nofollow(&name)?;
    let file = open_read(&recovery, Path::new(&format!(".native-state-{token}.json")))?;
    if identity(&file.metadata()?)? != request["proof"]["journal"]
        || identity(&recovery.dir_metadata()?)? != request["proof"]["recovery"]
    {
        return Err(invalid());
    }
    let mut data = Vec::new();
    file.take(32 * 1024 * 1024 + 1).read_to_end(&mut data)?;
    if data.len() > 32 * 1024 * 1024 {
        return Err(invalid());
    }
    let journal = replay(&data)?;
    if journal.token != token
        || identity(&recovery.dir_metadata()?)? != journal.recovery_identity
        || journal.storage_root.parent() != path.parent()
        || journal.root_identity != request["proof"]["root"]
    {
        return Err(invalid());
    }
    let root = open_absolute(&journal.storage_root, false)?;
    if identity(&root.dir_metadata()?)? != journal.root_identity {
        return Err(invalid());
    }
    if string(request, "action")? == "rollback" {
        rollback(&root, &recovery, &journal)?;
    } else if string(request, "action")? != "commit" {
        return Err(invalid());
    }
    drop(recovery);
    parent.remove_dir_all(&name)?;
    sync_dir(&parent)?;
    Ok(success())
}

fn measure(dir: &Dir, entries: &mut usize, context: &OperationContext) -> CoreResult<u64> {
    let mut total = 0u64;
    let mut frames = vec![walk_frame(dir.try_clone()?)?];
    while let Some(frame) = frames.last_mut() {
        context.check()?;
        let Some(entry) = frame.entries.next() else {
            frames.pop();
            continue;
        };
        let name = entry?.file_name();
        *entries += 1;
        if *entries > MAX_ENTRIES {
            return Err(invalid());
        }
        let metadata = frame.directory.symlink_metadata(&name)?;
        if metadata.is_symlink() {
            return Err(invalid());
        }
        if metadata.is_dir() {
            let child = frame.directory.open_dir_nofollow(&name)?;
            if !same(&metadata, &child.dir_metadata()?) {
                return Err(invalid());
            }
            frames.push(walk_frame(child)?);
        } else if metadata.is_file() {
            total = total.checked_add(metadata.len()).ok_or_else(invalid)?;
        } else {
            return Err(invalid());
        }
    }
    Ok(total)
}
pub(super) fn capacity(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let mut devices = std::collections::BTreeMap::<String, (PathBuf, u64)>::new();
    for request in request["requests"].as_array().ok_or_else(invalid)? {
        let path = absolute(string(request, "directoryPath")?)?;
        let dir = open_absolute(&path, false)?;
        let device = identity(&dir.dir_metadata()?)?["dev"]
            .as_str()
            .ok_or_else(invalid)?
            .to_owned();
        let mut bytes = request["additionalBytes"]
            .as_str()
            .unwrap_or("0")
            .parse::<u64>()
            .map_err(|_| invalid())?;
        for source in request["sourcePaths"].as_array().ok_or_else(invalid)? {
            let source = absolute(source.as_str().ok_or_else(invalid)?)?;
            let (parent, name) = parent(&source, false)?;
            let metadata = parent.symlink_metadata(&name)?;
            let size = if metadata.is_symlink() {
                return Err(invalid());
            } else if metadata.is_file() {
                metadata.len()
            } else if metadata.is_dir() {
                measure(&parent.open_dir_nofollow(&name)?, &mut 0, context)?
            } else {
                return Err(invalid());
            };
            bytes = bytes.checked_add(size).ok_or_else(invalid)?;
        }
        let entry = devices.entry(device).or_insert((path, 0));
        entry.1 = entry.1.checked_add(bytes).ok_or_else(invalid)?;
    }
    for (_, (path, bytes)) in devices {
        let required = bytes.checked_add(1024 * 1024 * 1024).ok_or_else(invalid)?;
        if fs4::available_space(path)? < required {
            return Err(CoreError::new(
                "STORAGE_CAPACITY",
                "Für den sicheren Storage-Rollback ist nicht genügend Speicherplatz verfügbar.",
            ));
        }
    }
    Ok(success())
}

#[cfg(test)]
#[path = "../../tests/unit/storage_recovery.rs"]
mod tests;
