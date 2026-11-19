use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::Path;

use serde_json::Value;

use super::invalid;
use super::references;
use super::ustar::Entry;

const DOCUMENT_LIMIT: u64 = 4 * 1024 * 1024;

pub(super) struct Files<'a> {
    directory: &'a Path,
    sizes: HashMap<&'a str, u64>,
}

impl<'a> Files<'a> {
    pub fn new(directory: &'a Path, entries: &'a [Entry]) -> Self {
        let sizes = entries
            .iter()
            .filter(|entry| !entry.directory && entry.size != 0)
            .map(|entry| (entry.path.as_str(), entry.size))
            .collect();
        Self { directory, sizes }
    }

    pub fn required(&self, path: &str) -> io::Result<u64> {
        self.sizes
            .get(path)
            .copied()
            .ok_or_else(|| invalid(format!("Missing or empty candidate package file: {path}")))
    }

    pub fn read(&self, path: &str) -> io::Result<Vec<u8>> {
        if self.required(path)? > DOCUMENT_LIMIT {
            return Err(invalid("Candidate document exceeds its size limit"));
        }
        fs::read(self.directory.join(path))
    }

    pub fn json(&self, path: &str) -> io::Result<Value> {
        decode_json(&self.read(path)?, path)
    }

    fn text(&self, path: &str) -> io::Result<String> {
        String::from_utf8(self.read(path)?)
            .ok()
            .filter(|text| !text.contains('\0') && !trim_wire(text).is_empty())
            .ok_or_else(|| invalid(format!("Invalid UTF-8 candidate document: {path}")))
    }
}

pub(super) fn decode_json(bytes: &[u8], path: &str) -> io::Result<Value> {
    let candidate_error = |_| invalid(format!("Invalid or ambiguous candidate JSON: {path}"));
    let json = marketplace_artifacts::parse_json(bytes).map_err(candidate_error)?;
    marketplace_artifacts::validate_wire_json(&json).map_err(candidate_error)?;
    Ok(json)
}

fn trim_wire(text: &str) -> &str {
    text.trim_matches(|character| {
        matches!(character, '\u{9}'..='\u{d}' | ' ' | '\u{a0}' | '\u{1680}'
            | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
            | '\u{205f}' | '\u{3000}' | '\u{feff}')
    })
}

fn nonempty_string(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|text| !trim_wire(text).is_empty() && text.encode_utf16().count() <= 256)
}

fn open_api_document(value: &Value) -> io::Result<()> {
    let version = value["openapi"].as_str().and_then(|version| {
        version
            .strip_prefix("3.0.")
            .or_else(|| version.strip_prefix("3.1."))
    });
    if !version.is_some_and(|patch| {
        (1..=3).contains(&patch.len()) && patch.bytes().all(|b| b.is_ascii_digit())
    }) || !nonempty_string(&value["info"]["title"])
        || !nonempty_string(&value["info"]["version"])
        || !value["paths"].as_object().is_some_and(|paths| {
            paths.iter().all(|(path, item)| {
                path.starts_with("x-")
                    || (path.starts_with('/') && !path.starts_with("//") && item.is_object())
            })
        })
        || value
            .get("components")
            .is_some_and(|components| !components.is_object())
    {
        return Err(invalid("Invalid candidate OpenAPI document"));
    }
    Ok(())
}

pub(super) fn validate(files: &Files<'_>, manifest: &Value) -> io::Result<()> {
    let license = files.text("LICENSE")?;
    let missing_license = |name: &str| {
        ["NOASSERTION", "NONE", "UNLICENSED"]
            .iter()
            .any(|unlicensed| name.eq_ignore_ascii_case(unlicensed))
    };
    if missing_license(field(&manifest["display"], "license"))
        || missing_license(trim_wire(&license))
    {
        return Err(invalid(
            "Candidate requires declared license metadata and a package license",
        ));
    }
    files.required(field(manifest, "entrypoint"))?;
    if let Some(ui) = manifest.get("ui") {
        files.text(field(ui, "entrypoint"))?;
    }

    let api_path = field(manifest, "api");
    let api = files.json(api_path)?;
    open_api_document(&api)?;
    let mut documents = vec![(api_path, api, references::Node::Api)];
    if let Some(schema_path) = manifest["configSchema"].as_str() {
        let schema = files.json(schema_path)?;
        if !(schema.is_boolean() || schema.is_object()) {
            return Err(invalid("Invalid candidate JSON configuration schema"));
        }
        documents.push((schema_path, schema, references::Node::Schema));
    }
    references::verify(files, documents)?;

    if let Some(migrations) = manifest["data"]["migrations"].as_array() {
        for migration in migrations {
            let path = field(migration, "path");
            if path.ends_with(".json") {
                files.json(path)?;
            } else {
                files.text(path)?;
            }
        }
    }
    Ok(())
}

fn field<'a>(record: &'a Value, key: &str) -> &'a str {
    record[key].as_str().expect("validated manifest string")
}

#[cfg(test)]
mod tests {
    use super::decode_json;

    #[test]
    fn package_json_rejects_duplicate_names_and_malformed_utf8() {
        let path = "schemas/config.json";
        for bytes in [
            &br#"{"healthy":false,"healthy":true}"#[..],
            &br#"{"healthy":false,"\u0068ealthy":true}"#[..],
            &[0x22, 0xc0, 0xaf, 0x22],
        ] {
            assert!(decode_json(bytes, path).is_err());
        }
        let distinct =
            decode_json(br#"{"healthy":true,"nested":{"healthy":false}}"#, path).unwrap();
        assert_eq!(distinct["healthy"], true);
        assert_eq!(distinct["nested"]["healthy"], false);
    }
}
