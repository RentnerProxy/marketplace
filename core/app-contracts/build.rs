use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let packaged_schema = manifest_dir.join("contracts.schema.json");
    let schema = if packaged_schema.is_file() {
        packaged_schema
    } else {
        manifest_dir.join("../../contracts/v1/contracts.schema.json")
    };

    println!("cargo::rerun-if-changed={}", schema.display());
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    fs::copy(&schema, out.join("contracts.schema.json"))
        .unwrap_or_else(|error| panic!("Cannot bundle {}: {error}", schema.display()));
}
