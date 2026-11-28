use super::evidence::{MANIFEST_TYPE, digest};
use crate::security::invalid;
use rentnerproxy_artifacts::{digest as hash_bytes, hash_stream, open_regular, parse_json};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

pub(super) const MAX_ARCHIVE: u64 = 16 * 1024 * 1024 * 1024;
pub(super) const MAX_JSON: u64 = 1024 * 1024;
const MAX_ENTRIES: usize = 4096;
const BLOCK: u64 = 512;

struct MeasuredArchive {
    file: BufReader<File>,
    hash: Sha256,
    len: u64,
}

impl Read for MeasuredArchive {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let size = self.file.read(buffer)?;
        self.len += size as u64;
        if self.len > MAX_ARCHIVE {
            return Err(invalid("Dev OCI archive exceeds its size limit"));
        }
        self.hash.update(&buffer[..size]);
        Ok(size)
    }
}

#[derive(Clone, Copy)]
struct Blob {
    offset: u64,
    size: u64,
}

fn doc(reader: &mut impl Read, size: u64) -> io::Result<(Value, String)> {
    if size > MAX_JSON {
        return Err(invalid("Dev OCI document exceeds its size limit"));
    }
    let mut bytes = Vec::with_capacity(size as usize);
    reader.take(size).read_to_end(&mut bytes)?;
    if bytes.len() as u64 != size {
        return Err(invalid("Truncated Dev OCI document"));
    }
    Ok((parse_json(&bytes)?, hash_bytes(&bytes)))
}

fn descriptor<'a>(value: &'a Value, blobs: &BTreeMap<String, Blob>) -> io::Result<(&'a str, Blob)> {
    let digest = digest(&value["digest"])?;
    let hash = &digest["sha256:".len()..];
    let blob = blobs
        .get(hash)
        .ok_or_else(|| invalid("Dev OCI descriptor refers to a missing blob"))?;
    if value["size"].as_u64() != Some(blob.size)
        || value.get("data").is_some()
        || value
            .get("urls")
            .is_some_and(|value| !value.as_array().is_some_and(Vec::is_empty))
    {
        return Err(invalid("Dev OCI descriptor size or data source is invalid"));
    }
    Ok((hash, *blob))
}

fn blob_doc(
    reader: &mut BufReader<File>,
    blobs: &BTreeMap<String, Blob>,
    value: &Value,
) -> io::Result<Value> {
    let (hash, blob) = descriptor(value, blobs)?;
    reader.seek(SeekFrom::Start(blob.offset))?;
    let (value, actual) = doc(reader, blob.size)?;
    if actual != hash {
        return Err(invalid(
            "Dev OCI document changed after reading the archive",
        ));
    }
    Ok(value)
}

pub(super) fn read(path: &Path) -> io::Result<Value> {
    let (file, original) = open_regular(path, MAX_ARCHIVE)?;
    let mut reader = MeasuredArchive {
        file: BufReader::new(file),
        hash: Sha256::new(),
        len: 0,
    };
    let mut index = None;
    let mut layout = None;
    let mut blobs = BTreeMap::new();
    let mut paths = BTreeSet::new();
    {
        let mut archive = tar::Archive::new(&mut reader);
        for entry in archive.entries()?.raw(true) {
            let mut entry = entry?;
            let path = entry.path_bytes().into_owned();
            let path =
                std::str::from_utf8(&path).map_err(|_| invalid("Invalid Dev OCI archive path"))?;
            let path = path.strip_prefix("./").unwrap_or(path);
            let kind = entry.header().entry_type();
            let path = if kind.is_dir() {
                path.strip_suffix('/').unwrap_or(path)
            } else {
                path
            };
            if !paths.insert(path.to_owned()) || paths.len() > MAX_ENTRIES {
                return Err(invalid("Duplicate or excessive Dev OCI archive paths"));
            }
            let size = entry.size();
            if kind.is_dir() && matches!(path, "" | "." | "blobs" | "blobs/sha256") && size == 0 {
                continue;
            }
            if !kind.is_file() {
                return Err(invalid("Dev OCI archive contains an unsupported entry"));
            }
            match path {
                "index.json" => index = Some(doc(&mut entry, size)?.0),
                "oci-layout" => layout = Some(doc(&mut entry, size)?.0),
                _ => {
                    let hash = path
                        .strip_prefix("blobs/sha256/")
                        .filter(|value| crate::security::lower_hex(value, 64))
                        .ok_or_else(|| invalid("Invalid Dev OCI archive path"))?;
                    let offset = entry.raw_file_position();
                    let actual = hash_stream(&mut entry, io::sink(), size)?;
                    if hash != actual.sha256 || size != actual.size_bytes {
                        return Err(invalid(
                            "Dev OCI blob content does not match its SHA-256 path",
                        ));
                    }
                    blobs.insert(hash.to_owned(), Blob { offset, size });
                }
            }
        }
    }

    let end_of_entries = reader.len;
    let mut remainder = [0; 8192];
    loop {
        let count = reader.read(&mut remainder)?;
        if count == 0 {
            break;
        }
        if remainder[..count].iter().any(|byte| *byte != 0) {
            return Err(invalid("Dev OCI archive has unexpected trailing data"));
        }
    }
    let final_length = reader.len;
    let archive_hash = reader.hash.finalize();
    if final_length - end_of_entries < BLOCK
        || !final_length.is_multiple_of(BLOCK)
        || final_length != original.len()
    {
        return Err(invalid("Incomplete Dev OCI archive trailer"));
    }

    let index = index.ok_or_else(|| invalid("Dev OCI archive is missing its index"))?;
    let layout =
        layout.ok_or_else(|| invalid("Dev OCI archive is missing its layout descriptor"))?;
    let entry = match index["manifests"].as_array().map(Vec::as_slice) {
        Some([entry]) => entry,
        _ => return Err(invalid("Dev OCI archive must contain one image manifest")),
    };
    if index["schemaVersion"] != 2
        || layout["imageLayoutVersion"] != "1.0.0"
        || entry["mediaType"] != MANIFEST_TYPE
    {
        return Err(invalid("Dev OCI archive must contain one image manifest"));
    }
    if let Some(platform) = entry.get("platform")
        && (platform["os"] != "linux" || platform["architecture"] != "amd64")
    {
        return Err(invalid("Dev OCI index platform must be linux/amd64"));
    }
    let manifest = blob_doc(&mut reader.file, &blobs, entry)?;
    let config_descriptor = &manifest["config"];
    let config = blob_doc(&mut reader.file, &blobs, config_descriptor)?;
    let layers = manifest["layers"]
        .as_array()
        .filter(|entries| !entries.is_empty())
        .ok_or_else(|| invalid("Dev OCI manifest is missing its layers"))?;
    let config_digests = &config["rootfs"]["diff_ids"];
    if config["rootfs"]["type"] != "layers"
        || config_digests
            .as_array()
            .is_none_or(|entries| entries.len() != layers.len())
    {
        return Err(invalid(
            "Dev OCI config layer count does not match the manifest",
        ));
    }
    for (layer, config_digest) in layers
        .iter()
        .zip(config_digests.as_array().into_iter().flatten())
    {
        descriptor(layer, &blobs)?;
        digest(config_digest)?;
    }
    let current = reader.file.get_ref().metadata()?;
    if current.len() != original.len() || current.modified()? != original.modified()? {
        return Err(invalid("Dev OCI archive changed while reading"));
    }
    let archive_hash: String = archive_hash
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(json!({
        "archiveSha256": archive_hash,
        "manifestDigest": entry["digest"],
        "imageId": config_descriptor["digest"],
        "manifest": manifest,
        "config": config,
    }))
}
