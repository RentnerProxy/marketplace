use std::{
    io::{self, Write},
    path::PathBuf,
};

use marketplace_artifacts::{parse_json, read_file};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{dependency::has_dependencies, evidence::order::OrderedJson};

pub(crate) const SIZE_LIMIT: u64 = 16 * 1024 * 1024;
const COMPONENT_LIMIT: usize = 16_384;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizeInput {
    input: Value,
    manifest: ManifestIdentity,
    has_dependencies: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizeFileInput {
    path: PathBuf,
    manifest: ManifestIdentity,
    dependencies_directory: PathBuf,
}

#[derive(Deserialize)]
struct ManifestIdentity {
    id: String,
    version: String,
    display: DisplayIdentity,
}

#[derive(Deserialize)]
struct DisplayIdentity {
    license: String,
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn list(value: Option<&OrderedJson>) -> io::Result<Option<&[OrderedJson]>> {
    value
        .map(|value| {
            value
                .as_array()
                .filter(|values| values.len() <= COMPONENT_LIMIT)
                .ok_or_else(|| invalid("Invalid or oversized Candidate SBOM list"))
        })
        .transpose()
}

fn object(value: Option<&OrderedJson>) -> io::Result<Option<&OrderedJson>> {
    value
        .map(|value| {
            if value.is_object() {
                Ok(value)
            } else {
                Err(invalid("Invalid Candidate SBOM object"))
            }
        })
        .transpose()
}

fn bounded_string(value: Option<&OrderedJson>, limit: usize) -> bool {
    value
        .and_then(OrderedJson::as_str)
        .is_some_and(|text| !text.is_empty() && text.encode_utf16().count() <= limit)
}

fn verify(bom: &OrderedJson) -> io::Result<()> {
    let format = bom.get("bomFormat").and_then(OrderedJson::as_str);
    let specification = bom.get("specVersion").and_then(OrderedJson::as_str);
    let valid_version = bom
        .get("version")
        .and_then(OrderedJson::as_integer)
        .is_some_and(|number| (1..=9_007_199_254_740_991).contains(&number));
    if format != Some("CycloneDX")
        || !specification.is_some_and(|specification| {
            matches!(specification.as_bytes(), [b'1', b'.', b'0'..=b'7'])
        })
        || !valid_version
    {
        return Err(invalid("Invalid Candidate CycloneDX evidence"));
    }
    for field in ["dependencies", "vulnerabilities", "services"] {
        list(bom.get(field))?;
    }
    let components = list(bom.get("components"))?
        .ok_or_else(|| invalid("Candidate SBOM has no component inventory"))?;
    let mut pending: Vec<_> = components.iter().collect();
    if let Some(root) = object(bom.get("metadata"))?.and_then(|data| data.get("component")) {
        pending.push(root);
    }
    let mut count = pending.len();
    while let Some(component) = pending.pop() {
        if count > COMPONENT_LIMIT {
            return Err(invalid("Candidate SBOM has too many components"));
        }
        if !bounded_string(component.get("name"), 4096)
            || !bounded_string(component.get("type"), 64)
        {
            return Err(invalid("Invalid Candidate SBOM component"));
        }
        if let Some(children) = list(component.get("components"))? {
            count += children.len();
            pending.extend(children);
        }
    }
    Ok(())
}

pub(crate) fn verify_bytes(bytes: &[u8]) -> io::Result<()> {
    verify(&OrderedJson::parse(bytes)?)
}

fn normalize(
    mut bom: OrderedJson,
    manifest: ManifestIdentity,
    has_deps: bool,
) -> io::Result<OrderedJson> {
    if !bom.is_object() {
        return Err(invalid("Invalid Candidate CycloneDX evidence"));
    }
    // The previous report parser emitted declared members in schema order,
    // then preserved extension members in the order supplied by Trivy.
    bom.prioritize_fields(&[
        "bomFormat",
        "specVersion",
        "version",
        "components",
        "dependencies",
        "metadata",
    ]);
    let components = list(bom.get("components"))?;
    if has_deps && components.is_none_or(<[_]>::is_empty) {
        return Err(invalid("Candidate dependency inventory is empty"));
    }
    if components.is_none() {
        bom.set("components", OrderedJson::Array(Vec::new()));
    }
    let mut metadata = object(bom.get("metadata"))?
        .cloned()
        .unwrap_or_else(|| OrderedJson::Object(Vec::new()));
    metadata.prioritize_fields(&["component"]);
    let mut component = object(metadata.get("component"))?
        .cloned()
        .unwrap_or_else(|| OrderedJson::Object(Vec::new()));
    component.set("type", OrderedJson::String("application".to_owned()));
    component.set("name", OrderedJson::String(manifest.id));
    component.set("version", OrderedJson::String(manifest.version));
    component.set(
        "licenses",
        OrderedJson::from(&json!([{ "license": { "name": manifest.display.license } }])),
    );
    metadata.set("component", component);
    bom.set("metadata", metadata);
    verify(&bom)?;
    Ok(bom)
}

fn normalize_file(input: NormalizeFileInput) -> io::Result<Value> {
    let package = read_file(
        &input.dependencies_directory.join("package.json"),
        1024 * 1024,
    )?;
    let package = package.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&package);
    let has_deps = has_dependencies(&parse_json(package)?)?;
    let scanner_output = read_file(&input.path, SIZE_LIMIT)?;
    if scanner_output.is_empty() {
        return Err(invalid("Candidate SBOM violates its size limit"));
    }
    let bom = normalize(
        OrderedJson::parse(&scanner_output)?,
        input.manifest,
        has_deps,
    )?;
    let mut bytes = bom.compact_scanner_bytes()?;
    bytes.push(b'\n');
    if bytes.len() as u64 > SIZE_LIMIT {
        return Err(invalid("Candidate SBOM violates its size limit"));
    }
    let parent = input
        .path
        .parent()
        .ok_or_else(|| invalid("Invalid SBOM output path"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(&bytes)?;
    temporary.persist(input.path).map_err(|error| error.error)?;
    Ok(Value::Null)
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation {
        "normalize" => {
            let input: NormalizeInput = serde_json::from_value(input)?;
            let bom = normalize(
                OrderedJson::from(&input.input),
                input.manifest,
                input.has_dependencies,
            )?;
            Ok(serde_json::to_value(bom)?)
        }
        "normalize-file" => normalize_file(serde_json::from_value(input)?),
        _ => Err(invalid("Unknown SBOM operation")),
    }
}
