use std::collections::HashMap;
use std::fs::{DirBuilder, File, Metadata, OpenOptions};
use std::io::{self, BufReader, Read};
use std::path::Path;

use super::{ARCHIVE_LIMIT, invalid};

const BLOCK: usize = 512;
const FILE_LIMIT: u64 = 64 * 1024 * 1024;
pub(super) const EXECUTABLE_LIMIT: u64 = 192 * 1024 * 1024;
const ENTRY_LIMIT: usize = 4096;

pub(super) struct Entry {
    pub path: String,
    pub directory: bool,
    pub executable: bool,
    pub size: u64,
}

struct Location {
    path: String,
    directory: bool,
    declared: bool,
}

pub(super) fn extract(input: &File, before: &Metadata, staging: &Path) -> io::Result<Vec<Entry>> {
    let size = before.len();
    if !(2 * BLOCK as u64..=ARCHIVE_LIMIT).contains(&size) || !size.is_multiple_of(BLOCK as u64) {
        return Err(invalid("Invalid candidate archive file or length"));
    }

    let mut reader = BufReader::new(input).take(size);
    let mut entries = Vec::new();
    let mut locations = HashMap::new();
    let mut dotted = None;
    let mut header = [0; BLOCK];

    let mut count = 0;
    loop {
        if reader.limit() == 0 {
            return Err(invalid("Missing ustar end blocks"));
        }
        reader.read_exact(&mut header)?;
        if zero(&header) {
            verify_end(&mut reader)?;
            let after = input.metadata()?;
            if after.len() != size || before.modified()? != after.modified()? {
                return Err(invalid("Candidate archive changed while reading"));
            }
            return Ok(entries);
        }
        count += 1;
        if count > ENTRY_LIMIT {
            return Err(invalid("Candidate archive has too many entries"));
        }
        let mut entry = parse_header(&header)?;
        let padding = (BLOCK as u64 - entry.size % BLOCK as u64) % BLOCK as u64;
        if entry.size + padding > reader.limit() {
            return Err(invalid("Truncated ustar entry or nonzero file padding"));
        }

        let uses_dot = entry.path.starts_with("./");
        if matches!(entry.path.as_str(), "./" | ".") {
            if !entry.directory || count != 1 {
                return Err(invalid("Invalid ustar root entry"));
            }
            dotted = Some(uses_dot);
            continue;
        }
        if dotted.is_some_and(|previous| previous != uses_dot) {
            return Err(invalid("Mixed ustar path prefixes"));
        }
        dotted = Some(uses_dot);
        entry.path = normalized_path(&entry, uses_dot)?.to_owned();
        index_location(&mut locations, &entry)?;
        stage_entry(&mut reader, staging, &entry)?;

        let padding = &mut header[..padding as usize];
        reader.read_exact(padding)?;
        if !zero(padding) {
            return Err(invalid("Truncated ustar entry or nonzero file padding"));
        }
        entries.push(entry);
    }
}

fn verify_end(reader: &mut io::Take<impl Read>) -> io::Result<()> {
    if reader.limit() < BLOCK as u64 {
        return Err(invalid(
            "Invalid ustar end blocks or data after the archive",
        ));
    }
    let mut buffer = [0; 8192];
    while reader.limit() != 0 {
        let count = reader.read(&mut buffer)?;
        if count == 0 || !zero(&buffer[..count]) {
            return Err(invalid(
                "Invalid ustar end blocks or data after the archive",
            ));
        }
    }
    Ok(())
}

fn zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|&byte| byte == 0)
}

fn string_field(bytes: &[u8]) -> io::Result<&str> {
    let end = bytes
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(bytes.len());
    let (value, padding) = bytes.split_at(end);
    if !zero(padding) || !value.iter().all(|byte| matches!(byte, 0x20..=0x7e)) {
        return Err(invalid("Invalid ustar text field"));
    }
    str::from_utf8(value).map_err(|_| invalid("Invalid ustar text field"))
}

fn octal_field(mut bytes: &[u8]) -> io::Result<u64> {
    while let Some(rest) = bytes.strip_prefix(b" ") {
        bytes = rest;
    }
    let digits = bytes
        .iter()
        .take_while(|&&byte| matches!(byte, b'0'..=b'7'))
        .count();
    if digits == 0
        || digits == bytes.len()
        || !bytes[digits..].iter().all(|byte| matches!(byte, 0 | b' '))
    {
        return Err(invalid("Invalid ustar numeric field"));
    }
    Ok(bytes[..digits]
        .iter()
        .fold(0, |value, &byte| value * 8 + u64::from(byte - b'0')))
}

fn parse_header(header: &[u8; BLOCK]) -> io::Result<Entry> {
    let checksum = header.iter().enumerate().fold(0u64, |sum, (index, &byte)| {
        sum + u64::from(if (148..156).contains(&index) {
            32
        } else {
            byte
        })
    });
    if octal_field(&header[148..156])? != checksum
        || &header[257..265] != b"ustar\x0000"
        || !zero(&header[500..])
    {
        return Err(invalid("Invalid ustar header"));
    }
    let directory = header[156] == b'5';
    if !matches!(header[156], 0 | b'0' | b'5') || !zero(&header[157..257]) {
        return Err(invalid(
            "Only regular ustar files and directories are supported",
        ));
    }

    let name = string_field(&header[..100])?;
    let prefix = string_field(&header[345..500])?;
    let path = if prefix.is_empty() {
        name.to_owned()
    } else {
        format!("{prefix}/{name}")
    };
    let mode = octal_field(&header[100..108])?;
    let executable = mode & 0o111 != 0;
    let size = octal_field(&header[124..136])?;
    let size_limit = if executable && !directory {
        EXECUTABLE_LIMIT
    } else {
        FILE_LIMIT
    };
    if mode
        != (if executable || directory {
            0o755
        } else {
            0o644
        })
        || size > size_limit
        || (directory && size != 0)
        || (!zero(&header[329..345])
            && (octal_field(&header[329..337])? != 0 || octal_field(&header[337..345])? != 0))
    {
        return Err(invalid(
            "Invalid ustar permissions, file size or device metadata",
        ));
    }
    // Ownership and archive timestamps have no effect during staging.
    octal_field(&header[108..116])?;
    octal_field(&header[116..124])?;
    octal_field(&header[136..148])?;
    Ok(Entry {
        path,
        directory,
        executable,
        size,
    })
}

pub(super) fn safe_package_path(path: &str) -> bool {
    path.len() <= 240 && path.split('/').all(safe_component)
}

fn safe_component(component: &str) -> bool {
    let mut segments = component.split('.');
    let base = segments.next().unwrap_or_default();
    let normalized = base.to_ascii_lowercase();
    let name = normalized.as_bytes();
    let device = matches!(name, b"con" | b"prn" | b"aux" | b"nul")
        || matches!(
            name,
            [b'c', b'o', b'm', b'0'..=b'9'] | [b'l', b'p', b't', b'0'..=b'9']
        );
    !device
        && std::iter::once(base).chain(segments).all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
}

fn normalized_path(entry: &Entry, dotted: bool) -> io::Result<&str> {
    let raw_path = if dotted {
        &entry.path[2..]
    } else {
        &entry.path
    };
    let path = if entry.directory {
        raw_path.strip_suffix('/').unwrap_or(raw_path)
    } else {
        raw_path
    };
    if !safe_package_path(path) {
        return Err(invalid("Unsafe ustar package path"));
    }
    let admitted = match path.split_once('/') {
        None if !entry.directory => matches!(path, "app.json" | "LICENSE") && !entry.executable,
        nested => {
            let root = nested.map_or(path, |(root, _)| root);
            matches!(
                root,
                "api" | "bin" | "licenses" | "migrations" | "schemas" | "ui"
            ) && (entry.directory || entry.executable == (root == "bin"))
        }
    };
    if !admitted {
        return Err(invalid("File or mode outside the candidate package layout"));
    }
    Ok(path)
}

fn index_location(locations: &mut HashMap<String, Location>, entry: &Entry) -> io::Result<()> {
    let paths = entry
        .path
        .match_indices('/')
        .map(|(index, _)| &entry.path[..index]);
    for path in paths.chain(std::iter::once(entry.path.as_str())) {
        let key = path.to_ascii_lowercase();
        let declared = path == entry.path;
        let directory = !declared || entry.directory;
        if locations.get(&key).is_some_and(|previous| {
            previous.path != path
                || previous.directory != directory
                || (declared && previous.declared)
        }) {
            return Err(invalid("Conflicting or duplicate ustar package path"));
        }
        if declared || !locations.contains_key(&key) {
            locations.insert(
                key,
                Location {
                    path: path.to_owned(),
                    directory,
                    declared,
                },
            );
        }
    }
    Ok(())
}

fn stage_entry(reader: &mut impl Read, staging: &Path, entry: &Entry) -> io::Result<()> {
    let path = staging.join(&entry.path);
    let mut builder = DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o755);
    }
    if entry.directory {
        return builder.create(&path);
    }
    builder.create(path.parent().unwrap_or(staging))?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(if entry.executable { 0o755 } else { 0o644 });
    }
    let mut destination = options.open(path)?;
    if io::copy(&mut reader.take(entry.size), &mut destination)? != entry.size {
        return Err(invalid("Truncated ustar entry or nonzero file padding"));
    }
    Ok(())
}

#[cfg(unix)]
pub(super) fn set_root_permissions(path: &Path) -> io::Result<()> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
pub(super) fn set_root_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}
