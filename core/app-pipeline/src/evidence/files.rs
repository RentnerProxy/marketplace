use std::{
    collections::HashSet,
    fs,
    io::{self, Write},
    path::Path,
};

use marketplace_artifacts::{self as artifacts, FileIdentity};
use serde::Serialize;

use super::{METADATA_LIMIT, invalid};

pub(super) fn identity(bytes: &[u8]) -> FileIdentity {
    FileIdentity {
        sha256: artifacts::digest(bytes),
        size_bytes: bytes.len() as u64,
    }
}

pub(super) fn json_bytes(value: &impl Serialize) -> io::Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn require_nonempty(size: u64) -> io::Result<()> {
    if size == 0 {
        return Err(invalid("Invalid candidate evidence file or byte length"));
    }
    Ok(())
}

fn expect(actual: &FileIdentity, expected: Option<&FileIdentity>) -> io::Result<()> {
    if expected.is_some_and(|expected| actual != expected) {
        return Err(invalid("Candidate evidence digest or length mismatch"));
    }
    Ok(())
}

pub(super) fn file_identity(
    path: &Path,
    limit: u64,
    expected: Option<&FileIdentity>,
) -> io::Result<FileIdentity> {
    let actual = artifacts::file_identity(path, limit)?;
    require_nonempty(actual.size_bytes)?;
    expect(&actual, expected)?;
    Ok(actual)
}

pub(super) fn read_bytes(
    path: &Path,
    limit: u64,
    expected: Option<&FileIdentity>,
) -> io::Result<Vec<u8>> {
    let bytes = artifacts::read_file(path, limit)?;
    require_nonempty(bytes.len() as u64)?;
    if expected.is_some() {
        expect(&identity(&bytes), expected)?;
    }
    Ok(bytes)
}

pub(super) fn assert_directory(path: &Path) -> io::Result<()> {
    if !fs::symlink_metadata(path)?.is_dir() {
        return Err(invalid("Invalid candidate evidence directory"));
    }
    Ok(())
}

pub(super) fn check_directory(
    path: &Path,
    names: &[String],
    allow_missing: bool,
) -> io::Result<()> {
    assert_directory(path)?;
    let mut remaining: HashSet<_> = names.iter().map(String::as_str).collect();
    if remaining.len() != names.len() {
        return Err(invalid("Duplicate candidate evidence file name"));
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if !entry.file_type()?.is_file()
            || !entry
                .file_name()
                .to_str()
                .is_some_and(|name| remaining.remove(name))
        {
            return Err(invalid("Unexpected entry in candidate evidence directory"));
        }
    }
    if !allow_missing && !remaining.is_empty() {
        return Err(invalid("Missing files from candidate evidence directory"));
    }
    Ok(())
}

pub(super) fn prepare_output(path: &Path, names: &[String]) -> io::Result<()> {
    fs::create_dir_all(path)?;
    check_directory(path, names, true)
}

fn already_written(path: &Path, limit: u64, expected: &FileIdentity) -> io::Result<bool> {
    match file_identity(path, limit, Some(expected)) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

pub(super) fn copy_asset(
    source: &Path,
    destination: &Path,
    limit: u64,
    expected: &FileIdentity,
) -> io::Result<()> {
    if already_written(destination, limit, expected)? {
        return file_identity(source, limit, Some(expected)).map(|_| ());
    }
    match artifacts::copy_file(source, destination, limit, Some(expected)) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            file_identity(destination, limit, Some(expected)).map(|_| ())
        }
        Err(error) => Err(error),
    }
}

pub(super) fn save_metadata(directory: &Path, name: &str, bytes: &[u8]) -> io::Result<()> {
    if bytes.is_empty() || bytes.len() as u64 > METADATA_LIMIT {
        return Err(invalid("Candidate metadata violates its byte limit"));
    }
    let path = directory.join(name);
    let expected = identity(bytes);
    if already_written(&path, METADATA_LIMIT, &expected)? {
        return Ok(());
    }
    let mut target = tempfile::NamedTempFile::new_in(directory)?;
    target.write_all(bytes)?;
    target.flush()?;
    match target.persist_noclobber(&path) {
        Ok(_) => Ok(()),
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
            error.file.close()?;
            file_identity(&path, METADATA_LIMIT, Some(&expected)).map(|_| ())
        }
        Err(error) => Err(error.error),
    }
}
