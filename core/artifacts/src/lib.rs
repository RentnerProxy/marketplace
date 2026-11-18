mod json;

pub use json::{parse_json, validate_wire_json};

use cap_fs_ext::{FollowSymlinks, MetadataExt, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, File, Metadata, OpenOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};
use std::path::Path;

pub use std::io::{Error, ErrorKind, Result};

const BLOCK_SIZE: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileIdentity {
    pub sha256: String,
    pub size_bytes: u64,
}

pub fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

pub fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn parent(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
}

fn compatible(left: &Metadata, right: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        if (left.ctime(), left.ctime_nsec()) != (right.ctime(), right.ctime_nsec()) {
            return false;
        }
    }
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.len() == right.len()
        && right.nlink() == 1
        && right.is_file()
        && left.modified().ok() == right.modified().ok()
}

fn open(path: &Path, max_bytes: u64) -> io::Result<(File, Metadata)> {
    let name = path
        .file_name()
        .ok_or_else(|| invalid("Expected an artifact file name"))?;
    let dir = Dir::open_ambient_dir(parent(path), ambient_authority())?;
    let original = dir.symlink_metadata(name)?;
    if !original.is_file() || original.nlink() != 1 || original.len() > max_bytes {
        return Err(invalid("Invalid artifact file or byte length"));
    }
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = dir.open_with(name, &options)?;
    let metadata = file.metadata()?;
    if !compatible(&original, &metadata) {
        return Err(invalid("Artifact changed before reading"));
    }
    Ok((file, metadata))
}

pub fn open_regular(path: &Path, max_bytes: u64) -> io::Result<(std::fs::File, std::fs::Metadata)> {
    let (file, _) = open(path, max_bytes)?;
    let file = file.into_std();
    let metadata = file.metadata()?;
    Ok((file, metadata))
}

fn stable(file: &File, metadata: &Metadata, size: u64) -> io::Result<()> {
    if size != metadata.len() || !compatible(metadata, &file.metadata()?) {
        return Err(invalid("Artifact changed while reading"));
    }
    Ok(())
}

pub fn read_file(path: &Path, max_bytes: u64) -> io::Result<Vec<u8>> {
    let (mut file, metadata) = open(path, max_bytes)?;
    let capacity = usize::try_from(metadata.len())
        .map_err(|_| invalid("Artifact exceeds available address space"))?;
    let mut bytes = Vec::with_capacity(capacity);
    (&mut file)
        .take(metadata.len().saturating_add(1))
        .read_to_end(&mut bytes)?;
    stable(&file, &metadata, bytes.len() as u64)?;
    Ok(bytes)
}

pub fn hash_stream(
    mut source: impl Read,
    mut target: impl Write,
    max_bytes: u64,
) -> io::Result<FileIdentity> {
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0; BLOCK_SIZE];
    loop {
        let limit = (max_bytes - size).saturating_add(1).min(BLOCK_SIZE as u64) as usize;
        let count = source.read(&mut buffer[..limit])?;
        if count == 0 {
            break;
        }
        let chunk = &buffer[..count];
        size = size
            .checked_add(count as u64)
            .filter(|size| *size <= max_bytes)
            .ok_or_else(|| invalid("Artifact exceeds its byte limit"))?;
        hasher.update(chunk);
        target.write_all(chunk)?;
    }
    Ok(FileIdentity {
        sha256: hex::encode(hasher.finalize()),
        size_bytes: size,
    })
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StreamVerification {
    Verified,
    LengthExceeded,
    Mismatch,
}

pub fn verify_stream(
    source: impl Read,
    expected: &FileIdentity,
    destination: Option<&Path>,
) -> io::Result<StreamVerification> {
    let mut file = destination
        .map(|path| tempfile::NamedTempFile::new_in(parent(path)))
        .transpose()?;
    let mut sink = io::sink();
    let target: &mut dyn Write = match file.as_mut() {
        Some(file) => file,
        None => &mut sink,
    };
    let verification = match hash_stream(source, target, expected.size_bytes) {
        Ok(value) if &value == expected => StreamVerification::Verified,
        Ok(_) => StreamVerification::Mismatch,
        Err(error) if error.kind() == ErrorKind::InvalidData => StreamVerification::LengthExceeded,
        Err(error) => return Err(error),
    };
    if let (Some(mut file), Some(path)) = (file, destination) {
        if verification == StreamVerification::Verified {
            file.flush()?;
            file.persist_noclobber(path).map_err(|error| error.error)?;
        } else {
            file.close()?;
        }
    }
    Ok(verification)
}

pub fn file_identity(path: &Path, max_bytes: u64) -> io::Result<FileIdentity> {
    let (mut source, metadata) = open(path, max_bytes)?;
    let identity = hash_stream(&mut source, io::sink(), metadata.len())?;
    stable(&source, &metadata, identity.size_bytes)?;
    Ok(identity)
}

pub fn verify_file(path: &Path, expected: &FileIdentity) -> io::Result<()> {
    if file_identity(path, expected.size_bytes)? != *expected {
        return Err(invalid("Artifact digest or length mismatch"));
    }
    Ok(())
}

pub fn copy_file(
    source: &Path,
    destination: &Path,
    max_bytes: u64,
    expected: Option<&FileIdentity>,
) -> io::Result<FileIdentity> {
    let (mut source, metadata) = open(source, max_bytes)?;
    if expected.is_some_and(|expected| expected.size_bytes != metadata.len()) {
        return Err(invalid("Artifact digest or length mismatch"));
    }
    let mut target = tempfile::NamedTempFile::new_in(parent(destination))?;
    let identity = hash_stream(&mut source, &mut target, metadata.len())?;
    stable(&source, &metadata, identity.size_bytes)?;
    if expected.is_some_and(|expected| *expected != identity) {
        return Err(invalid("Artifact digest or length mismatch"));
    }
    target.flush()?;
    target
        .persist_noclobber(destination)
        .map_err(|error| error.error)?;
    Ok(identity)
}

pub fn read_request(reader: impl Read) -> io::Result<serde_json::Value> {
    const MAX: u64 = 32 * 1024 * 1024;
    let mut bytes = Vec::new();
    reader.take(MAX + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX {
        return Err(invalid("Native tool input exceeds its byte limit"));
    }
    parse_json(&bytes)
}
