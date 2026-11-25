use super::{
    CHUNK, MAX_CONTENT, MAX_ENTRIES, MAX_METADATA, MAX_PAX, MAX_PLAINTEXT, file_sync::FileSync,
    files, invalid,
};
use crate::protocol::{CoreResult, OperationContext};
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use std::collections::{HashMap, HashSet};
use std::io::{BufReader, Read, Write};
use std::path::Path;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

#[derive(Clone, Deserialize)]
pub(crate) struct Entry {
    pub path: String,
    pub size: u64,
    #[serde(rename = "type")]
    pub kind: String,
}
fn read_exact(file: &mut impl Read, buffer: &mut [u8]) -> CoreResult<()> {
    file.read_exact(buffer).map_err(|error| {
        if error.kind() == std::io::ErrorKind::UnexpectedEof {
            invalid("Das TAR-Archiv ist unvollständig.")
        } else {
            error.into()
        }
    })
}
pub(crate) fn validate_entry(path: &str, size: u64, kind: &str) -> CoreResult<Entry> {
    if !matches!(kind, "file" | "directory")
        || size > MAX_CONTENT
        || (kind == "directory" && size != 0)
    {
        return Err(invalid(
            "Das Backup enthält einen unsicheren Archiveintrag.",
        ));
    }
    let normalized: String = path.nfc().collect();
    let canonical = if kind == "directory" {
        normalized.strip_suffix('/').unwrap_or(&normalized)
    } else {
        &normalized
    };
    if canonical.is_empty() || canonical.len() > 4096 {
        return Err(invalid("Das Backup enthält einen unsicheren Archivpfad."));
    }
    let segments: Vec<_> = canonical.split('/').collect();
    if segments.len() > 64
        || normalized.contains(['\\', '\u{fffd}'])
        || segments.iter().any(|segment| {
            let base = segment.split('.').next().unwrap_or("").to_uppercase();
            segment.is_empty()
                || segment.len() > 255
                || matches!(*segment, "." | "..")
                || segment.ends_with(['.', ' '])
                || segment
                    .chars()
                    .any(|c| c <= '\u{1f}' || "<>:\"|?*".contains(c))
                || matches!(
                    base.as_str(),
                    "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
                )
                || ["COM", "LPT"].iter().any(|prefix| {
                    base.strip_prefix(prefix).is_some_and(|suffix| {
                        suffix.chars().count() == 1 && "123456789¹²³".contains(suffix)
                    })
                })
        })
    {
        return Err(invalid("Das Backup enthält einen unsicheren Archivpfad."));
    }
    let top = matches!(
        canonical,
        "manifest.json" | "database.dump" | "integrity.json"
    );
    if (top && kind != "file")
        || (canonical == "storage" && kind != "directory")
        || (!top && canonical != "storage" && !canonical.starts_with("storage/"))
    {
        return Err(invalid("Das Backup enthält einen unerwarteten Archivpfad."));
    }
    Ok(Entry {
        path: canonical.to_owned(),
        size,
        kind: kind.to_owned(),
    })
}
#[derive(Default)]
pub(crate) struct Paths {
    seen: HashSet<String>,
    files: HashSet<String>,
    directories: HashMap<String, String>,
    bytes: usize,
}
impl Paths {
    pub fn register(&mut self, entry: &Entry) -> CoreResult<()> {
        let key = entry.path.to_uppercase();
        self.bytes += entry.path.len();
        if self.seen.len() >= MAX_ENTRIES {
            return Err(invalid("Das Backup enthält zu viele Dateien."));
        }
        if self.bytes > 16 * 1024 * 1024 {
            return Err(invalid("Die Archivpfade überschreiten das Backup-Limit."));
        }
        if !self.seen.insert(key.clone()) {
            return Err(invalid("Das Backup enthält doppelte Archivpfade."));
        }
        let segments: Vec<_> = entry.path.split('/').collect();
        for index in 1..segments.len() {
            let parent = segments[..index].join("/");
            let portable = parent.to_uppercase();
            if self.files.contains(&portable)
                || self
                    .directories
                    .get(&portable)
                    .is_some_and(|existing| existing != &parent)
            {
                return Err(invalid(
                    "Das Backup enthält kollidierende Archivverzeichnisse.",
                ));
            }
            self.directories.insert(portable, parent);
        }
        if entry.kind == "file" {
            if self.directories.contains_key(&key) {
                return Err(invalid(
                    "Das Backup verwendet ein Verzeichnis als Archivdatei.",
                ));
            }
            self.files.insert(key);
        } else {
            if self
                .directories
                .get(&key)
                .is_some_and(|existing| existing != &entry.path)
            {
                return Err(invalid(
                    "Das Backup enthält kollidierende Archivverzeichnisse.",
                ));
            }
            self.directories.insert(key, entry.path.clone());
        }
        Ok(())
    }
}
pub(crate) struct Integrity {
    hmac: Hmac<Sha256>,
    count: u64,
    bytes: u64,
}
impl Integrity {
    pub fn new(key: &[u8]) -> Self {
        let mut derived = Zeroizing::new([0; 32]);
        Hkdf::<Sha256>::new(Some(b"tanstack-backup-key-v1"), key)
            .expand(b"archive-integrity-v2", derived.as_mut())
            .expect("32 Byte liegen innerhalb des HKDF-SHA-256-Ausgabelimits von 8160 Byte.");
        let mut hmac = Hmac::<Sha256>::new_from_slice(derived.as_ref())
            .expect("HMAC-SHA-256 akzeptiert Schlüssel beliebiger Länge.");
        hmac.update(b"tanstack-backup-integrity-v2\0");
        Self {
            hmac,
            count: 0,
            bytes: 0,
        }
    }
    pub fn start(&mut self, entry: &Entry) {
        self.hmac.update(&(entry.path.len() as u32).to_be_bytes());
        self.hmac
            .update(&[if entry.kind == "file" { 1 } else { 2 }]);
        self.hmac.update(&entry.size.to_be_bytes());
        self.hmac.update(entry.path.as_bytes());
        self.count += 1;
        if entry.kind == "file" {
            self.bytes += entry.size;
        }
    }
    pub fn update(&mut self, bytes: &[u8]) {
        self.hmac.update(bytes);
    }
    pub fn finish(self) -> Value {
        json!({"version":2,"algorithm":"hmac-sha256","entryCount":self.count,"totalBytes":self.bytes,"hmacSha256":files::hex(&self.hmac.finalize().into_bytes())})
    }
}
fn number(field: &[u8], base256: bool) -> CoreResult<u64> {
    if field[0] >= 128 {
        if !base256 || field[0] != 128 {
            return Err(invalid("Das TAR-Zahlenfeld ist ungültig."));
        }
        let mut value = 0u64;
        for byte in &field[1..] {
            value = value
                .checked_mul(256)
                .and_then(|v| v.checked_add(*byte as u64))
                .ok_or_else(|| invalid("Das TAR-Zahlenfeld ist zu groß."))?;
        }
        if value > 9007199254740991 {
            return Err(invalid("Das TAR-Zahlenfeld ist zu groß."));
        }
        return Ok(value);
    }
    let trimmed = field;
    let end = trimmed
        .iter()
        .rposition(|b| *b != 0 && *b != b' ')
        .map_or(0, |i| i + 1);
    let mut value = 0u64;
    for byte in &trimmed[..end] {
        if !(b'0'..=b'7').contains(byte) {
            return Err(invalid("Das TAR-Zahlenfeld ist ungültig."));
        }
        value = value
            .checked_mul(8)
            .and_then(|v| v.checked_add((byte - b'0') as u64))
            .ok_or_else(|| invalid("Das TAR-Zahlenfeld ist zu groß."))?;
    }
    if value > 9007199254740991 {
        return Err(invalid("Das TAR-Zahlenfeld ist zu groß."));
    }
    Ok(value)
}
fn string(field: &[u8]) -> CoreResult<String> {
    let end = field.iter().position(|b| *b == 0).unwrap_or(field.len());
    Ok(std::str::from_utf8(&field[..end])
        .map_err(|_| invalid("Der TAR-Pfad enthält ungültiges UTF-8."))?
        .to_owned())
}
fn pax_path(bytes: &[u8]) -> CoreResult<String> {
    let mut offset = 0;
    let mut path = None;
    while offset < bytes.len() {
        let space = bytes[offset..]
            .iter()
            .position(|b| *b == b' ')
            .ok_or_else(|| invalid("Der PAX-Header ist ungültig."))?
            + offset;
        let length = std::str::from_utf8(&bytes[offset..space])
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > space - offset + 1)
            .ok_or_else(|| invalid("Der PAX-Header ist ungültig."))?;
        let end = offset
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| invalid("Der PAX-Header ist unvollständig."))?;
        let record = &bytes[space + 1..end];
        if record.last() != Some(&b'\n') || !record.starts_with(b"path=") {
            return Err(invalid(
                "Das Backup enthält nicht unterstützte PAX-Metadaten.",
            ));
        }
        path = Some(
            std::str::from_utf8(&record[5..record.len() - 1])
                .map_err(|_| invalid("Der PAX-Pfad ist ungültig."))?
                .to_owned(),
        );
        offset = end;
    }
    path.ok_or_else(|| invalid("Der PAX-Pfad fehlt."))
}
pub(crate) fn validate_manifest(value: &Value) -> CoreResult<()> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Das Backup-Manifest ist ungültig."))?;
    let includes = value["includesStorage"]
        .as_bool()
        .ok_or_else(|| invalid("Das Backup-Manifest ist ungültig."))?;
    let version = value["version"]
        .as_u64()
        .ok_or_else(|| invalid("Das Backup-Manifest ist ungültig."))?;
    let fields = if version == 3 && includes { 5 } else { 4 };
    let created = value["createdAt"].as_str().unwrap_or("");
    if !matches!(version, 2 | 3)
        || object.len() != fields
        || !object.keys().all(|k| {
            matches!(
                k.as_str(),
                "version" | "includesStorage" | "createdAt" | "appVersion"
            ) || (version == 3 && includes && k == "privateBackgroundsVersion")
        })
        || (version == 3 && includes && value["privateBackgroundsVersion"] != 1)
        || value["appVersion"].as_str().is_none_or(str::is_empty)
        || !crate::validation::valid_iso_timestamp(created)
        || time::OffsetDateTime::parse(created, &time::format_description::well_known::Rfc3339)
            .is_err()
    {
        return Err(invalid(
            "Das Backup-Manifest ist ungültig oder nicht unterstützt.",
        ));
    }
    Ok(())
}
fn extracted_file(root: &cap_std::fs::Dir, path: &str) -> CoreResult<cap_std::fs::File> {
    let path = Path::new(path);
    let parent = crate::storage::files::descend(
        root,
        path.parent().unwrap_or(Path::new("")),
        true,
        crate::storage::files::DirectoryPermissions::Private,
    )?;
    crate::storage::files::create_file(
        &parent,
        Path::new(
            path.file_name()
                .ok_or_else(|| invalid("Der Extraktionspfad fehlt."))?,
        ),
    )
}
pub(crate) fn process(
    source: &Path,
    key: &[u8],
    destination: Option<&Path>,
    request: &Value,
    context: &OperationContext,
) -> CoreResult<Value> {
    process_with_sync(source, key, destination, request, context, || {
        FileSync::new(|file: cap_std::fs::File| file.sync_all())
    })
}

pub(super) fn validate_stream(
    source: impl Read,
    size: u64,
    key: &[u8],
    context: &OperationContext,
) -> CoreResult<Value> {
    process_reader(source, size, key, None, context, || {
        FileSync::new(|file: cap_std::fs::File| file.sync_all())
    })
}

fn process_with_sync(
    source: &Path,
    key: &[u8],
    destination: Option<&Path>,
    request: &Value,
    context: &OperationContext,
    start_sync: impl FnOnce() -> CoreResult<FileSync<cap_std::fs::File>>,
) -> CoreResult<Value> {
    let file = files::open_source(source)?;
    let snapshot = files::identity(&file)?;
    let manifest = process_reader(
        BufReader::with_capacity(super::crypto::FILE_BUFFER_SIZE, &file),
        snapshot.size,
        key,
        destination.map(|path| (path, request)),
        context,
        start_sync,
    )?;
    if files::identity(&file)? != snapshot {
        return Err(invalid("Die Größe des Backup-Archivs hat sich verändert."));
    }
    context.check_now()?;
    Ok(manifest)
}

fn process_reader(
    mut file: impl Read,
    source_size: u64,
    key: &[u8],
    extraction: Option<(&Path, &Value)>,
    context: &OperationContext,
    start_sync: impl FnOnce() -> CoreResult<FileSync<cap_std::fs::File>>,
) -> CoreResult<Value> {
    if !(1024..=MAX_PLAINTEXT).contains(&source_size) {
        return Err(invalid("Das TAR-Archiv überschreitet das Größenlimit."));
    }
    let empty_request = Value::Null;
    let (destination, request) = extraction.map_or((None, &empty_request), |(path, request)| {
        (Some(path), request)
    });
    let root = destination
        .map(|path| {
            let root = crate::storage::files::open_absolute(path, true)?;
            crate::storage::files::secure_directory(&root)?;
            Ok::<_, crate::protocol::CoreError>(root)
        })
        .transpose()?;
    let mut budget = files::Budget::new(request, MAX_CONTENT)?;
    let mut sync = root.as_ref().map(|_| start_sync()).transpose()?;
    let mut paths = Paths::default();
    let mut integrity = Integrity::new(key);
    let mut manifest = None;
    let mut expected_integrity = None;
    let mut database = false;
    let mut storage = false;
    let mut storage_root = false;
    let mut content = 0;
    let mut physical = 0;
    let mut zeros = 0;
    let mut pending_path = None;
    let mut consumed = 0u64;
    let mut buffer = Zeroizing::new(vec![0; CHUNK]);
    loop {
        context.check()?;
        let mut header = [0; 512];
        read_exact(&mut file, &mut header)?;
        consumed += 512;
        if header.iter().all(|b| *b == 0) {
            if pending_path.is_some() {
                return Err(invalid("Der PAX-Header ist unvollständig."));
            }
            zeros += 1;
            if zeros == 2 {
                break;
            }
            continue;
        }
        if zeros > 0 {
            return Err(invalid("Der TAR-Abschluss ist unvollständig."));
        }
        physical += 1;
        if physical > MAX_ENTRIES * 2 {
            return Err(invalid("Das Backup enthält zu viele TAR-Header."));
        }
        let checksum: u64 = header
            .iter()
            .enumerate()
            .map(|(index, byte)| {
                if (148..156).contains(&index) {
                    32
                } else {
                    *byte as u64
                }
            })
            .sum();
        if number(&header[148..156], false)? != checksum
            || &header[257..263] != b"ustar\0"
            || &header[263..265] != b"00"
        {
            return Err(invalid(
                "Das Backup enthält einen beschädigten oder nicht unterstützten TAR-Header.",
            ));
        }
        let size = number(&header[124..136], true)?;
        let kind = header[156];
        let pax = kind == b'x';
        if !matches!(kind, 0 | b'0' | b'5' | b'x')
            || !string(&header[157..257])?.is_empty()
            || (kind == b'5' && size != 0)
            || (pax && (size > MAX_PAX as u64 || pending_path.is_some()))
        {
            return Err(invalid(
                "Das Backup enthält einen unsicheren Archiveintrag.",
            ));
        }
        let padding = (512 - size % 512) % 512;
        if size > source_size.saturating_sub(consumed) {
            return Err(invalid("Das TAR-Archiv ist unvollständig."));
        }
        if pax {
            let mut bytes = vec![0; size as usize];
            read_exact(&mut file, &mut bytes)?;
            pending_path = Some(pax_path(&bytes)?);
        } else {
            if expected_integrity.is_some() {
                return Err(invalid(
                    "Die Integritätsinformationen müssen der letzte Archiveintrag sein.",
                ));
            }
            let prefix = string(&header[345..500])?;
            let name = string(&header[..100])?;
            let physical_path = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            let entry = validate_entry(
                &pending_path.take().unwrap_or(physical_path),
                size,
                if kind == b'5' { "directory" } else { "file" },
            )?;
            paths.register(&entry)?;
            if size > MAX_CONTENT - content {
                return Err(invalid(
                    "Das entpackte Backup überschreitet das Größenlimit.",
                ));
            }
            content += size;
            let metadata = matches!(entry.path.as_str(), "manifest.json" | "integrity.json");
            if metadata && size > MAX_METADATA {
                return Err(invalid("Ein Backup-Metadateneintrag ist zu groß."));
            }
            if entry.path != "integrity.json" {
                integrity.start(&entry);
            }
            let mut output = if let Some(root) = root.as_ref() {
                if entry.kind == "file" && !metadata {
                    Some(extracted_file(root, &entry.path)?)
                } else {
                    None
                }
            } else {
                None
            };
            if entry.kind == "directory"
                && let Some(root) = root.as_ref()
            {
                crate::storage::files::descend(
                    root,
                    Path::new(&entry.path),
                    true,
                    crate::storage::files::DirectoryPermissions::Private,
                )?;
            }
            let mut metadata_bytes = Vec::new();
            let mut remaining = size;
            while remaining > 0 {
                context.check()?;
                let length = remaining.min(CHUNK as u64) as usize;
                read_exact(&mut file, &mut buffer[..length])?;
                if entry.path != "integrity.json" {
                    integrity.update(&buffer[..length]);
                }
                if metadata {
                    metadata_bytes.extend_from_slice(&buffer[..length]);
                }
                if let Some(output) = output.as_mut() {
                    budget.before(length as u64, context)?;
                    output.write_all(&buffer[..length])?;
                }
                remaining -= length as u64;
            }
            if let Some(output) = output
                && let Some(sync) = sync.as_mut()
            {
                sync.submit(output)?;
            }
            match entry.path.as_str() {
                "manifest.json" => {
                    manifest = Some(
                        serde_json::from_slice::<Value>(&metadata_bytes).map_err(|_| {
                            invalid("Das Backup-Manifest enthält kein gültiges JSON.")
                        })?,
                    )
                }
                "integrity.json" => {
                    expected_integrity = Some(
                        serde_json::from_slice::<Value>(&metadata_bytes).map_err(|_| {
                            invalid("Die Integritätsinformationen enthalten kein gültiges JSON.")
                        })?,
                    )
                }
                "database.dump" => {
                    if size == 0 {
                        return Err(invalid("Der Datenbank-Dump ist leer."));
                    }
                    database = true;
                }
                "storage" => {
                    storage = true;
                    storage_root = true;
                }
                _ => storage = true,
            }
        }
        consumed += size;
        let mut pad = [0; 512];
        read_exact(&mut file, &mut pad[..padding as usize])?;
        consumed += padding;
        if pad[..padding as usize].iter().any(|b| *b != 0) {
            return Err(invalid("Das TAR-Padding ist ungültig."));
        }
    }
    loop {
        context.check()?;
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        consumed += read as u64;
        if consumed > source_size || buffer[..read].iter().any(|b| *b != 0) {
            return Err(invalid(
                "Das Backup enthält unerwartete Daten nach dem TAR-Ende.",
            ));
        }
    }
    // Finish durability work before observing the source identity and final
    // cancellation state, just as with the former serial file syncs.
    if let Some(sync) = sync.take() {
        sync.finish()?;
    }
    if consumed != source_size {
        return Err(invalid("Die Größe des Backup-Archivs hat sich verändert."));
    }
    let manifest = manifest.ok_or_else(|| invalid("Das Backup-Manifest fehlt."))?;
    validate_manifest(&manifest)?;
    if !database
        || manifest["includesStorage"].as_bool() != Some(storage)
        || (storage && !storage_root)
    {
        return Err(invalid(
            "Backup-Manifest und Archivinhalt stimmen nicht überein.",
        ));
    }
    let actual = integrity.finish();
    let expected =
        expected_integrity.ok_or_else(|| invalid("Die Integritätsinformationen fehlen."))?;
    if expected.as_object().is_none_or(|o| o.len() != 5)
        || expected["version"] != 2
        || expected["algorithm"] != "hmac-sha256"
        || expected["entryCount"] != actual["entryCount"]
        || expected["totalBytes"] != actual["totalBytes"]
        || expected["hmacSha256"].as_str().is_none_or(|value| {
            value.len() != 64
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
    {
        return Err(invalid(
            "Die Integritätsprüfung des Backups ist fehlgeschlagen.",
        ));
    }
    use subtle::ConstantTimeEq;
    if !bool::from(
        actual["hmacSha256"]
            .as_str()
            .unwrap_or("")
            .as_bytes()
            .ct_eq(expected["hmacSha256"].as_str().unwrap_or("").as_bytes()),
    ) {
        return Err(invalid(
            "Die Integritätsprüfung des Backups ist fehlgeschlagen.",
        ));
    }
    context.check_now()?;
    Ok(manifest)
}

fn octal(field: &mut [u8], value: u64) -> CoreResult<()> {
    let encoded = format!("{:0width$o}", value, width = field.len() - 1);
    if encoded.len() >= field.len() {
        return Err(invalid("Das TAR-Zahlenfeld ist zu groß."));
    }
    field.fill(0);
    field[..encoded.len()].copy_from_slice(encoded.as_bytes());
    Ok(())
}
fn header(output: &mut impl Write, path: &str, size: u64, kind: u8, mtime: u64) -> CoreResult<()> {
    let mut header = [0; 512];
    header[..path.len()].copy_from_slice(path.as_bytes());
    octal(
        &mut header[100..108],
        if kind == b'5' { 0o700 } else { 0o600 },
    )?;
    octal(&mut header[108..116], 0)?;
    octal(&mut header[116..124], 0)?;
    if size > 0o77777777777 {
        header[124] = 128;
        header[128..136].copy_from_slice(&size.to_be_bytes());
    } else {
        octal(&mut header[124..136], size)?;
    }
    octal(&mut header[136..148], mtime)?;
    header[148..156].fill(32);
    header[156] = kind;
    header[257..263].copy_from_slice(b"ustar\0");
    header[263..265].copy_from_slice(b"00");
    let checksum: u64 = header.iter().map(|b| *b as u64).sum();
    let encoded = format!("{checksum:06o}\0 ");
    header[148..156].copy_from_slice(encoded.as_bytes());
    output.write_all(&header)?;
    Ok(())
}
pub(crate) fn write_header(output: &mut impl Write, entry: &Entry, mtime: u64) -> CoreResult<()> {
    if entry.path.len() > 100 || !entry.path.is_ascii() {
        let body = format!("path={}\n", entry.path);
        let mut length = body.len() + 2;
        loop {
            let next = body.len() + length.to_string().len() + 1;
            if next == length {
                break;
            }
            length = next;
        }
        let record = format!("{length} {body}");
        header(output, "PaxHeader", record.len() as u64, b'x', mtime)?;
        output.write_all(record.as_bytes())?;
        write_padding(output, record.len() as u64)?;
        header(
            output,
            "PaxEntry",
            entry.size,
            if entry.kind == "directory" {
                b'5'
            } else {
                b'0'
            },
            mtime,
        )
    } else {
        header(
            output,
            &entry.path,
            entry.size,
            if entry.kind == "directory" {
                b'5'
            } else {
                b'0'
            },
            mtime,
        )
    }
}
pub(crate) fn write_padding(output: &mut impl Write, size: u64) -> CoreResult<()> {
    let padding = (512 - size % 512) % 512;
    output.write_all(&[0; 512][..padding as usize])?;
    Ok(())
}

#[cfg(test)]
#[path = "../../tests/unit/archive_tar.rs"]
mod tests;
