use super::invalid;
use marketplace_artifacts::{hash_stream, parse_json, read_file};
use serde_json::Value;
use std::fs;
use std::io;
use std::path::Path;

pub(super) fn hash_installed_file(path: &Path) -> io::Result<String> {
    // Bun's content-addressed installation legitimately hard-links parser files.
    if !fs::symlink_metadata(path)?.is_file() {
        return Err(invalid("Expected a regular file at its installed path"));
    }
    let mut file = fs::File::open(path)?;
    let original = file.metadata()?;
    if !original.is_file() || original.len() > 4 * 1024 * 1024 {
        return Err(invalid("Invalid installed file or byte length"));
    }
    let identity = hash_stream(&mut file, io::sink(), original.len())?;
    let current = file.metadata()?;
    if current.len() != identity.size_bytes || original.modified()? != current.modified()? {
        return Err(invalid("Installed file changed while reading"));
    }
    Ok(identity.sha256)
}

pub(crate) fn read(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    read_file(path, limit)
}

pub(crate) fn json(path: &Path, limit: u64) -> io::Result<Value> {
    parse_json(&read(path, limit)?)
}

// The trusted root may use the platform's extended path syntax after canonicalization.
// Resolve each child separately so links within the tree cannot redirect validation.
pub(crate) fn no_links(root: &Path, relative: &Path) -> io::Result<()> {
    if !fs::symlink_metadata(root)?.is_dir() {
        return Err(invalid("Expected a regular artifact directory"));
    }
    for ancestor in root.ancestors().filter(|path| !path.as_os_str().is_empty()) {
        if fs::symlink_metadata(ancestor)?.is_symlink() {
            return Err(invalid("Expected a regular file at its installed path"));
        }
    }
    let mut path = root.to_owned();
    for component in relative.components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err(invalid("Invalid artifact path"));
        }
        path.push(component);
        if fs::symlink_metadata(&path)?.is_symlink() {
            return Err(invalid("Expected a regular file at its installed path"));
        }
    }
    if fs::canonicalize(&path)? != fs::canonicalize(root)?.join(relative) {
        return Err(invalid("Expected a regular file at its installed path"));
    }
    Ok(())
}
