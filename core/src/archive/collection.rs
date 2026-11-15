use super::{CHUNK, MAX_CONTENT, MAX_ENTRIES, MAX_METADATA, files, invalid, root_key, tar, text};
use crate::protocol::{CoreResult, OperationContext};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::collections::btree_map::Entry;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    #[serde(flatten)]
    entry: tar::Entry,
    absolute_path: Option<PathBuf>,
}
fn walk(
    root: &Path,
    archive: &str,
    entries: &mut Vec<Source>,
    context: &OperationContext,
) -> CoreResult<()> {
    context.check()?;
    let metadata = fs::symlink_metadata(root)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(invalid(
            "Der konfigurierte Storage ist kein sicheres Verzeichnis.",
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(invalid("Der Storage enthält eine unsichere Verknüpfung."));
        }
    }
    entries.push(Source {
        entry: tar::validate_entry(archive, 0, "directory")?,
        absolute_path: None,
    });
    let directory = crate::storage::files::open_absolute(root, false)?;
    let mut children = Vec::new();
    for child in directory.entries()? {
        if children.len() + entries.len() + 3 >= MAX_ENTRIES {
            return Err(invalid("Der Storage enthält zu viele Backup-Einträge."));
        }
        children.push(child?);
    }
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        context.check()?;
        if entries.len() + 4 > MAX_ENTRIES {
            return Err(invalid("Der Storage enthält zu viele Backup-Einträge."));
        }
        let name = child
            .file_name()
            .into_string()
            .map_err(|_| invalid("Ein Storage-Pfad enthält ungültiges UTF-8."))?;
        let archive_path = format!("{archive}/{name}");
        let path = root.join(child.file_name());
        let metadata = directory.symlink_metadata(child.file_name())?;
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            walk(&path, &archive_path, entries, context)?;
        } else {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(invalid(
                    "Der Storage enthält einen nicht unterstützten Dateityp.",
                ));
            }
            let file = files::open_source(&path)?;
            entries.push(Source {
                entry: tar::validate_entry(&archive_path, file.metadata()?.len(), "file")?,
                absolute_path: Some(path),
            });
        }
    }
    Ok(())
}
fn collect(request: &Value, context: &OperationContext) -> CoreResult<Vec<Source>> {
    let mut entries = Vec::new();
    walk(
        Path::new(text(request, "storageRoot")?),
        "storage",
        &mut entries,
        context,
    )?;
    if let Some(private_entries) = request.get("privateEntries").and_then(Value::as_array) {
        let mut preferred = BTreeMap::new();
        for value in private_entries {
            let mut source: Source = serde_json::from_value(value.clone())?;
            source.entry =
                tar::validate_entry(&source.entry.path, source.entry.size, &source.entry.kind)?;
            if source.entry.kind != "file" || source.absolute_path.is_none() {
                return Err(invalid("Die private Backup-Quelldatei ist ungültig."));
            }
            if preferred.len() >= MAX_ENTRIES
                || preferred
                    .insert(source.entry.path.clone(), source)
                    .is_some()
            {
                return Err(invalid(
                    "Der private Storage enthält zu viele oder kollidierende Archivpfade.",
                ));
            }
        }
        for entry in &mut entries {
            if let Some(replacement) = preferred.remove(&entry.entry.path) {
                if entry.entry.kind != "file" {
                    return Err(invalid(
                        "Privater Storage kollidiert mit einem Verzeichnis.",
                    ));
                }
                *entry = replacement;
            }
        }
        let mut existing: BTreeMap<String, String> = entries
            .iter()
            .map(|source| (source.entry.path.clone(), source.entry.kind.clone()))
            .collect();
        for (_, entry) in preferred {
            let segments: Vec<_> = entry.entry.path.split('/').collect();
            for index in 1..segments.len() {
                let parent = segments[..index].join("/");
                match existing.entry(parent) {
                    Entry::Occupied(parent) => {
                        if parent.get() != "directory" {
                            return Err(invalid("Privater Storage kollidiert mit einer Datei."));
                        }
                    }
                    Entry::Vacant(parent) => {
                        entries.push(Source {
                            entry: tar::validate_entry(parent.key(), 0, "directory")?,
                            absolute_path: None,
                        });
                        parent.insert("directory".to_owned());
                    }
                }
            }
            entries.push(entry);
        }
    }
    let mut paths = tar::Paths::default();
    let mut bytes = 0u64;
    for entry in &entries {
        paths.register(&entry.entry)?;
        if entry.entry.size > MAX_CONTENT - MAX_METADATA - bytes {
            return Err(invalid("Der Storage überschreitet das Backup-Größenlimit."));
        }
        bytes += entry.entry.size;
    }
    if entries.len() + 3 > MAX_ENTRIES {
        return Err(invalid("Der Storage enthält zu viele Backup-Einträge."));
    }
    Ok(entries)
}
pub(crate) fn collect_request(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    Ok(serde_json::to_value(collect(request, context)?)?)
}
fn buffer_entry(
    writer: &mut impl Write,
    path: &str,
    bytes: &[u8],
    integrity: Option<&mut tar::Integrity>,
    mtime: u64,
) -> CoreResult<()> {
    let entry = tar::validate_entry(path, bytes.len() as u64, "file")?;
    if let Some(integrity) = integrity {
        integrity.start(&entry);
        integrity.update(bytes);
    }
    tar::write_header(writer, &entry, mtime)?;
    writer.write_all(bytes)?;
    tar::write_padding(writer, entry.size)
}
pub(crate) fn create(request: &Value, context: &OperationContext) -> CoreResult<Value> {
    let key = root_key(request)?;
    let manifest = request
        .get("manifest")
        .ok_or_else(|| invalid("Das Backup-Manifest fehlt."))?;
    tar::validate_manifest(manifest)?;
    let manifest_bytes =
        if let Some(encoded) = request.get("manifestContent").and_then(Value::as_str) {
            if serde_json::from_str::<Value>(encoded)? != *manifest {
                return Err(invalid("Das Backup-Manifest stimmt nicht überein."));
            }
            encoded.as_bytes().to_vec()
        } else {
            serde_json::to_vec_pretty(manifest)?
        };
    if manifest_bytes.len() as u64 > MAX_METADATA {
        return Err(invalid(
            "Das Backup-Manifest überschreitet das Größenlimit.",
        ));
    }
    let mut entries = if manifest["includesStorage"] == true {
        collect(request, context)?
    } else {
        Vec::new()
    };
    let database_path = PathBuf::from(text(request, "databaseDumpPath")?);
    let database = files::open_source(&database_path)?;
    let database_size = database.metadata()?.len();
    if database_size == 0 {
        return Err(invalid("Der Datenbank-Dump ist leer."));
    }
    drop(database);
    entries.insert(
        0,
        Source {
            entry: tar::validate_entry("database.dump", database_size, "file")?,
            absolute_path: Some(database_path),
        },
    );
    let total = entries
        .iter()
        .try_fold(manifest_bytes.len() as u64, |total, entry| {
            total
                .checked_add(entry.entry.size)
                .ok_or_else(|| invalid("Das Backup überschreitet das Größenlimit."))
        })?;
    if total > MAX_CONTENT - MAX_METADATA {
        return Err(invalid("Das Backup überschreitet das Größenlimit."));
    }
    let output = Path::new(text(request, "destinationPath")?);
    let mut writer = super::crypto::EncryptWriter::new(output, &key, context)?;
    let result = (|| {
        let mut integrity = tar::Integrity::new(&key);
        let mtime = request.get("mtime").and_then(Value::as_u64).unwrap_or(0);
        let mut paths = tar::Paths::default();
        paths.register(&tar::validate_entry(
            "manifest.json",
            manifest_bytes.len() as u64,
            "file",
        )?)?;
        context.progress(json!({"phase":"archiving","processedBytes":0,"totalBytes":total}))?;
        buffer_entry(
            &mut writer,
            "manifest.json",
            &manifest_bytes,
            Some(&mut integrity),
            mtime,
        )?;
        let mut processed = manifest_bytes.len() as u64;
        context
            .progress(json!({"phase":"archiving","processedBytes":processed,"totalBytes":total}))?;
        for source in entries {
            context.check()?;
            paths.register(&source.entry)?;
            integrity.start(&source.entry);
            tar::write_header(&mut writer, &source.entry, mtime)?;
            if source.entry.kind == "file" {
                let mut file = files::open_source(
                    source
                        .absolute_path
                        .as_deref()
                        .ok_or_else(|| invalid("Die Backup-Quelldatei fehlt."))?,
                )?;
                let before = files::identity(&file)?;
                if before.size != source.entry.size {
                    return Err(invalid(
                        "Eine Backup-Quelldatei wurde während der Erstellung verändert.",
                    ));
                }
                let mut read = 0;
                let mut buffer = [0; CHUNK];
                loop {
                    context.check()?;
                    let count = file.read(&mut buffer)?;
                    if count == 0 {
                        break;
                    }
                    read += count as u64;
                    if read > source.entry.size {
                        return Err(invalid(
                            "Eine Backup-Quelldatei wurde während der Erstellung verändert.",
                        ));
                    }
                    integrity.update(&buffer[..count]);
                    writer.write_all(&buffer[..count])?;
                    processed += count as u64;
                    context.progress(
                        json!({"phase":"archiving","processedBytes":processed,"totalBytes":total}),
                    )?;
                }
                if read != source.entry.size || files::identity(&file)? != before {
                    return Err(invalid(
                        "Eine Backup-Quelldatei wurde während der Erstellung verändert.",
                    ));
                }
            }
            tar::write_padding(&mut writer, source.entry.size)?;
        }
        let integrity_bytes = serde_json::to_vec_pretty(&integrity.finish())?;
        buffer_entry(&mut writer, "integrity.json", &integrity_bytes, None, mtime)?;
        writer.write_all(&[0; 1024])?;
        Ok(serde_json::to_value(writer.finish()?)?)
    })();
    if result.is_err() {
        fs::remove_file(output)?;
    }
    result
}
