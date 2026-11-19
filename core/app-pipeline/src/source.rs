use std::{collections::HashSet, io};

use serde::Deserialize;
use serde_json::{Value, json};

const PACKAGE_LIMIT: u64 = 1024 * 1024;
const LOCK_LIMIT: u64 = 8 * 1024 * 1024;
const ARCHIVE_LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TreeInput {
    tree: GitTree,
    expected_tree: String,
}

#[derive(Deserialize)]
struct GitTree {
    sha: String,
    truncated: bool,
    tree: Vec<TreeEntry>,
}

#[derive(Deserialize)]
struct TreeEntry {
    sha: String,
    #[serde(rename = "type")]
    kind: EntryKind,
    #[serde(default, deserialize_with = "optional_size")]
    size: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum EntryKind {
    Tree,
    Blob,
}

#[derive(Deserialize)]
struct DirectoryInput {
    entry: String,
    path: String,
}

#[derive(Deserialize)]
struct FileInput {
    entry: String,
    name: String,
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn optional_size<'de, D: serde::Deserializer<'de>>(input: D) -> Result<Option<u64>, D::Error> {
    u64::deserialize(input).map(Some)
}

fn commit(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn check_tree(input: TreeInput) -> io::Result<Value> {
    let tree = input.tree;
    if !commit(&tree.sha) || input.expected_tree != tree.sha {
        return Err(invalid("Submitted source tree identity changed"));
    }
    if tree.truncated || tree.tree.len() > 10_000 {
        return Err(invalid(
            "Submitted source tree is truncated or has too many entries",
        ));
    }
    let mut bytes = 1024;
    let mut seen = HashSet::new();
    let mut blobs = Vec::new();
    for entry in tree.tree {
        if !commit(&entry.sha) || entry.size.is_some_and(|size| size > ARCHIVE_LIMIT) {
            return Err(invalid("Invalid submitted GitHub tree entry"));
        }
        if matches!(entry.kind, EntryKind::Blob) {
            if entry.size.is_none() {
                return Err(invalid("GitHub did not report the submitted blob size"));
            }
            if seen.insert(entry.sha.clone()) {
                blobs.push(entry.sha);
            }
        }
        bytes += 512 + entry.size.unwrap_or_default().div_ceil(512) * 512;
        if bytes > ARCHIVE_LIMIT {
            return Err(invalid("Submitted source tree exceeds its byte budget"));
        }
    }
    Ok(json!(blobs))
}

fn checked_path(path: &str) -> bool {
    path.len() <= 200
        && path.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.eq_ignore_ascii_case(".git")
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
        })
}

fn check_directory(input: DirectoryInput) -> io::Result<Value> {
    let entry = input
        .entry
        .strip_prefix("040000 tree ")
        .and_then(|value| value.strip_suffix('\0'))
        .and_then(|value| value.split_once('\t'));
    match entry {
        Some((sha, path)) if commit(sha) && path == input.path && checked_path(path) => {
            Ok(json!(sha))
        }
        _ => Err(invalid(
            "Submitted source path must be a committed directory",
        )),
    }
}

fn check_staged_file(input: FileInput) -> io::Result<Value> {
    let (limit, required) = match input.name.as_str() {
        "package.json" => (PACKAGE_LIMIT, true),
        "bun.lock" => (LOCK_LIMIT, false),
        _ => return Err(invalid("Unexpected staged candidate input")),
    };
    let entry = input.entry.trim_end();
    if entry.is_empty() && !required {
        return Ok(json!({"present": false, "limit": limit}));
    }
    let regular = entry
        .strip_prefix("100644 blob ")
        .or_else(|| entry.strip_prefix("100755 blob "))
        .and_then(|value| value.split_once('\t'))
        .is_some_and(|(sha, name)| commit(sha) && name == input.name);
    if !regular {
        return Err(invalid(&format!(
            "Submitted {} must be a committed regular file",
            input.name
        )));
    }
    Ok(json!({"present": true, "limit": limit}))
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation {
        "tree" => check_tree(serde_json::from_value(input)?),
        "directory" => check_directory(serde_json::from_value(input)?),
        "staged-file" => check_staged_file(serde_json::from_value(input)?),
        _ => Err(invalid("Unknown source operation")),
    }
}
