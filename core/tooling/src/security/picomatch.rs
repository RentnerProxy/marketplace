use super::{files, invalid, sha256_digest, string};
use serde_json::{Value, json};
use std::fs;
use std::io;
use std::path::Path;

const PACKAGE: &str = "picomatch@4.0.7";
const PATCH: &str = "patches/picomatch@4.0.7.patch";
const PATCH_HASH: &str = "550d716012d83ec38cb7c7001e2421a7bcbd4b4a61c34f12a0e936945808d15d";
const PARSER: &str = "lib/parse.js";
const PARSER_HASH: &str = "46c326dda81c8afdb936e69773d03a5233534ddfec054d74ce5bdb68ab8cc337";
const ADVISORY: &str = "--ignore=GHSA-fc5q-39xc-vjpf";
const MANIFEST_LIMIT: u64 = 1024 * 1024;

pub(super) fn package_path() -> String {
    format!("app/node_modules/.bun/{PACKAGE}/node_modules/picomatch")
}

fn patch_declaration(document: &Value) -> io::Result<Option<&str>> {
    let object = document
        .as_object()
        .ok_or_else(|| invalid("Invalid Bun manifest"))?;
    let Some(patches) = object.get("patchedDependencies") else {
        return Ok(None);
    };
    let declarations = patches
        .as_object()
        .ok_or_else(|| invalid("Invalid Bun patch declarations"))?;
    if declarations.values().any(|value| !value.is_string()) {
        return Err(invalid("Invalid Bun patch declarations"));
    }
    Ok(declarations.get(PACKAGE).and_then(Value::as_str))
}

fn check_hash(root: &Path, relative: &Path, expected: &str) -> io::Result<()> {
    files::no_links(root, relative)?;
    if files::hash_installed_file(&root.join(relative))? != expected {
        return Err(invalid(
            "Unexpected picomatch patch or installed parser digest.",
        ));
    }
    Ok(())
}

pub(super) fn audit(input: &Value) -> io::Result<Value> {
    let root = Path::new(string(input, "root")?);
    let lock = &input["lock"];
    let declaration = patch_declaration(lock)?;
    let packages = lock["packages"]
        .as_object()
        .ok_or_else(|| invalid("Invalid Bun lock packages"))?;
    let mut selected = false;
    let mut unexpected = false;
    for package in packages.values() {
        let resolution = package
            .as_array()
            .and_then(|entry| entry.first())
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("Invalid Bun lock package resolution"))?;
        selected |= resolution == PACKAGE;
        unexpected |= resolution.starts_with("picomatch@") && resolution != PACKAGE;
    }
    let mut args = vec!["--no-env-file", "audit", "--audit-level=moderate"];
    if !selected {
        return Ok(json!(args));
    }

    let manifest_path = Path::new("package.json");
    files::no_links(root, manifest_path)?;
    let manifest = files::json(&root.join(manifest_path), MANIFEST_LIMIT)?;
    if unexpected || declaration != Some(PATCH) || patch_declaration(&manifest)? != Some(PATCH) {
        return Err(invalid(
            "The picomatch advisory requires the exact patch for every locked copy.",
        ));
    }
    check_hash(root, Path::new(PATCH), PATCH_HASH)?;

    let store = Path::new("node_modules/.bun");
    files::no_links(root, store)?;
    let mut copies = 0;
    for entry in fs::read_dir(root.join(store))? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with("picomatch@") {
            let relative = store.join(name).join("node_modules/picomatch").join(PARSER);
            check_hash(root, &relative, PARSER_HASH)?;
            copies += 1;
        }
    }
    if copies == 0 {
        return Err(invalid(
            "No installed picomatch parser found in the Bun store.",
        ));
    }
    args.push(ADVISORY);
    Ok(json!(args))
}

pub(super) fn image_package(root: &Path) -> io::Result<()> {
    let relative = Path::new("package.json");
    files::no_links(root, relative)?;
    let manifest = files::json(&root.join(relative), MANIFEST_LIMIT)?;
    if manifest["name"] != "picomatch" || manifest["version"] != PACKAGE["picomatch@".len()..] {
        return Err(invalid("Unexpected installed picomatch identity."));
    }
    check_hash(root, Path::new(PARSER), PARSER_HASH)
}

pub(super) fn scan_index(root: &Path) -> io::Result<()> {
    let relative = Path::new("index.json");
    files::no_links(root, relative)?;
    let index = files::json(&root.join(relative), MANIFEST_LIMIT)?;
    let manifest = match index["manifests"].as_array().map(Vec::as_slice) {
        Some([manifest]) => manifest,
        _ => return Err(invalid("Expected one OCI image manifest tagged scan.")),
    };
    if index["schemaVersion"] != 2
        || manifest["mediaType"] != "application/vnd.oci.image.manifest.v1+json"
        || manifest["annotations"]["org.opencontainers.image.ref.name"] != "scan"
        || !manifest["digest"].as_str().is_some_and(sha256_digest)
    {
        return Err(invalid("Expected one OCI image manifest tagged scan."));
    }
    Ok(())
}
