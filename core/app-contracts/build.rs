use std::{
    env, fs,
    path::{Path, PathBuf},
};

/// Bundle a contract document from the packaged crate or, in the repository, from contracts/v1.
fn bundle(manifest_dir: &Path, out: &Path, name: &str) {
    let packaged = manifest_dir.join(name);
    let source = if packaged.is_file() {
        packaged
    } else {
        manifest_dir.join("../../contracts/v1").join(name)
    };

    println!("cargo::rerun-if-changed={}", source.display());
    fs::copy(&source, out.join(name))
        .unwrap_or_else(|error| panic!("Cannot bundle {}: {error}", source.display()));
}

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    bundle(&manifest_dir, &out, "contracts.schema.json");
    bundle(&manifest_dir, &out, "upstream-probe-fixtures.json");
}
