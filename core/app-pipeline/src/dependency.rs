mod jsonc;

use std::{fs, io, path::PathBuf, sync::LazyLock};

use marketplace_artifacts::{digest, parse_json, read_file};
use regex::Regex;
use serde::Deserialize;
use serde_json::{Map, Value, json};

const GROUPS: [&str; 4] = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
];
const NAME: &str = r"(?:@[a-zA-Z0-9._-]+/)?[a-zA-Z0-9_-][a-zA-Z0-9._-]*";
static PACKAGE_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"^{NAME}$")).unwrap());
static RANGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:[0-9^~<>=*]|[xX](?:\.|$))[0-9a-zA-Z.*^~<>=+| -]*$").unwrap());
static SPECIFIER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^{NAME}@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.+-]+)?$"
    ))
    .unwrap()
});
static INTEGRITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^sha(?:1|256|384|512)-[a-zA-Z0-9+/]+=*$").unwrap());

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdmitInput {
    directory: PathBuf,
    output_directory: PathBuf,
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn object(input: &Value) -> io::Result<&Map<String, Value>> {
    input
        .as_object()
        .ok_or_else(|| invalid("Invalid staged candidate dependency input"))
}

fn reject_fields(input: &Map<String, Value>, names: &[&str]) -> io::Result<()> {
    if names.iter().any(|name| input.contains_key(*name)) {
        return Err(invalid("Unsupported candidate dependency configuration"));
    }
    Ok(())
}

fn matched(input: &Value, pattern: &Regex) -> bool {
    input.as_str().is_some_and(|value| pattern.is_match(value))
}

fn dependency_map(input: &Value) -> bool {
    input.as_object().is_some_and(|entries| {
        entries
            .iter()
            .all(|(package, range)| PACKAGE_NAME.is_match(package) && matched(range, &RANGE))
    })
}

fn retain(
    input: &Map<String, Value>,
    output: &mut Map<String, Value>,
    field: &str,
    admit: impl Fn(&Value) -> bool,
) -> io::Result<()> {
    if let Some(value) = input.get(field) {
        if !admit(value) {
            return Err(invalid("Invalid staged candidate dependency input"));
        }
        output.insert(field.to_owned(), value.clone());
    }
    Ok(())
}

fn root_manifest(input: &Map<String, Value>) -> io::Result<Map<String, Value>> {
    let mut output = Map::new();
    retain(input, &mut output, "name", |value| {
        matched(value, &PACKAGE_NAME)
    })?;
    retain(input, &mut output, "version", Value::is_string)?;
    for field in GROUPS {
        retain(input, &mut output, field, dependency_map)?;
    }
    Ok(output)
}

fn package_manifest(input: &Value) -> io::Result<Map<String, Value>> {
    let fields = object(input)?;
    reject_fields(
        fields,
        &["workspaces", "patchedDependencies", "resolutions"],
    )?;
    if !input["scripts"]["build"]
        .as_str()
        .is_some_and(|script| !script.is_empty())
    {
        return Err(invalid("Candidate package.json requires a build script"));
    }
    let mut output = root_manifest(fields)?;
    retain(fields, &mut output, "overrides", dependency_map)?;
    Ok(output)
}

pub(crate) fn has_dependencies(input: &Value) -> io::Result<bool> {
    let fields = object(input)?;
    let mut any = false;
    for group in GROUPS {
        if let Some(group) = fields.get(group) {
            let group = object(group)?;
            if !group.values().all(Value::is_string) {
                return Err(invalid("Invalid staged candidate dependency input"));
            }
            any |= !group.is_empty();
        }
    }
    Ok(any)
}

fn string_list(input: &Value) -> bool {
    input
        .as_array()
        .is_some_and(|entries| entries.iter().all(Value::is_string))
}

fn locked_package(input: &Value) -> io::Result<Value> {
    let invalid_entry = || invalid("Invalid candidate dependency lock entry");
    let entry = input.as_array().ok_or_else(invalid_entry)?;
    let [specifier, registry, metadata, integrity] = entry.as_slice() else {
        return Err(invalid_entry());
    };
    let specifier = specifier
        .as_str()
        .filter(|value| SPECIFIER.is_match(value))
        .ok_or_else(invalid_entry)?;
    let registry = registry.as_str().ok_or_else(invalid_entry)?;
    if !matched(integrity, &INTEGRITY) {
        return Err(invalid_entry());
    }
    let (name, version) = specifier.rsplit_once('@').ok_or_else(invalid_entry)?;
    let base = name.rsplit('/').next().ok_or_else(invalid_entry)?;
    if !registry.is_empty()
        && registry != format!("https://registry.npmjs.org/{name}/-/{base}-{version}.tgz")
    {
        return Err(invalid(
            "Candidate dependency locks must resolve packages through the public npm registry",
        ));
    }
    let metadata = object(metadata)?;
    let mut output = Map::new();
    for group in ["dependencies", "optionalDependencies", "peerDependencies"] {
        retain(metadata, &mut output, group, dependency_map)?;
    }
    retain(metadata, &mut output, "optionalPeers", |value| {
        value
            .as_array()
            .is_some_and(|entries| entries.iter().all(|entry| matched(entry, &PACKAGE_NAME)))
    })?;
    retain(metadata, &mut output, "bin", |bin| {
        bin.is_string()
            || bin.as_object().is_some_and(|entries| {
                entries
                    .iter()
                    .all(|(name, path)| PACKAGE_NAME.is_match(name) && path.is_string())
            })
    })?;
    for constraint in ["os", "cpu", "libc"] {
        retain(metadata, &mut output, constraint, |value| {
            value.is_string() || string_list(value)
        })?;
    }
    retain(metadata, &mut output, "bundled", Value::is_boolean)?;
    Ok(json!([specifier, registry, output, integrity]))
}

fn lockfile(input: &Value) -> io::Result<Value> {
    let fields = object(input)?;
    reject_fields(fields, &["patchedDependencies", "catalogs"])?;
    let version = match input["lockfileVersion"].as_f64() {
        Some(2.0) => 2,
        Some(3.0) => 3,
        _ => return Err(invalid("Unsupported candidate Bun lockfile version")),
    };
    let workspaces = object(&input["workspaces"])?;
    if workspaces.len() != 1 || !workspaces.contains_key("") {
        return Err(invalid(
            "Candidate dependency locks require a single root workspace",
        ));
    }
    let workspace = root_manifest(object(&workspaces[""])?)?;
    let packages = object(&input["packages"])?
        .iter()
        .map(|(name, entry)| Ok((name.clone(), locked_package(entry)?)))
        .collect::<io::Result<Map<String, Value>>>()?;
    let mut output = Map::from_iter([
        ("lockfileVersion".to_owned(), json!(version)),
        ("workspaces".to_owned(), json!({"": workspace})),
        ("packages".to_owned(), Value::Object(packages)),
    ]);
    if let Some(config) = fields.get("configVersion") {
        if config.as_f64() != Some(1.0) {
            return Err(invalid("Unsupported candidate Bun lockfile configuration"));
        }
        output.insert("configVersion".to_owned(), json!(1));
    }
    retain(fields, &mut output, "overrides", dependency_map)?;
    Ok(Value::Object(output))
}

fn admit(input: AdmitInput) -> io::Result<Value> {
    let package = read_file(&input.directory.join("package.json"), 1024 * 1024)?;
    let lock = match read_file(&input.directory.join("bun.lock"), 8 * 1024 * 1024) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    let manifest = Value::Object(package_manifest(&parse_json(jsonc::strip_bom(&package))?)?);
    let needs_install = has_dependencies(&manifest)?;
    let mut identities = json!({
        "packageSha256": digest(&package),
        "hasDependencies": needs_install,
    });
    if let Some(bytes) = &lock {
        identities["lockSha256"] = json!(digest(bytes));
    }
    if needs_install {
        let lock =
            lock.ok_or_else(|| invalid("Candidate dependencies require a frozen bun.lock"))?;
        let lock = lockfile(&parse_json(&jsonc::strict_json(&lock)?)?)?;
        fs::create_dir(&input.output_directory)?;
        fs::write(
            input.output_directory.join("package.json"),
            serde_json::to_vec(&manifest)?,
        )?;
        fs::write(
            input.output_directory.join("bun.lock"),
            serde_json::to_vec(&lock)?,
        )?;
    }
    Ok(identities)
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation {
        "admit" => admit(serde_json::from_value(input)?),
        _ => Err(invalid("Unknown dependency operation")),
    }
}
