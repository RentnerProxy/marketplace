use marketplace_tooling::security::execute;
use serde_json::json;
use std::{fs, io};
use tempfile::TempDir;

const PATCH: &str = "patches/picomatch@4.0.7.patch";
const FIXTURE_PATCH: &[u8] = include_bytes!("../../../patches/picomatch@4.0.7.patch");
const STORE: &str = "node_modules/.bun";

#[test]
fn advisory_exemption_requires_exact_lock_manifest_patch_and_installed_parser() -> io::Result<()> {
    let root = TempDir::new()?;
    fs::create_dir(root.path().join("patches"))?;
    let store = root.path().join(STORE);
    fs::create_dir_all(&store)?;
    let manifest = json!({"patchedDependencies": {"picomatch@4.0.7": PATCH}});
    fs::write(
        root.path().join("package.json"),
        serde_json::to_vec(&manifest)?,
    )?;
    let mut lock = manifest;
    lock["packages"] = json!({"picomatch": ["picomatch@4.0.7"]});
    let mut input = json!({"root": root.path(), "lock": lock});
    let patch = root.path().join(PATCH);
    fs::write(&patch, b"unreviewed replacement")?;
    assert!(
        execute("security-picomatch-audit", input.clone())
            .unwrap_err()
            .to_string()
            .contains("patch or installed parser digest")
    );

    fs::write(&patch, FIXTURE_PATCH)?;
    assert!(
        execute("security-picomatch-audit", input.clone())
            .unwrap_err()
            .to_string()
            .contains("No installed picomatch parser")
    );
    let installed = store.join("picomatch@4.0.7/node_modules/picomatch/lib");
    fs::create_dir_all(&installed)?;
    fs::write(installed.join("parse.js"), b"unpatched parser")?;
    assert!(
        execute("security-picomatch-audit", input.clone())
            .unwrap_err()
            .to_string()
            .contains("patch or installed parser digest")
    );
    input["lock"]["packages"]["another/picomatch"] = json!(["picomatch@4.0.6"]);
    assert!(
        execute("security-picomatch-audit", input.clone())
            .unwrap_err()
            .to_string()
            .contains("every locked copy")
    );
    input["lock"]["packages"] = json!({"picomatch": ["picomatch@4.0.8"]});
    assert_eq!(
        execute("security-picomatch-audit", input)?,
        json!(["--no-env-file", "audit", "--audit-level=moderate"]),
    );
    Ok(())
}

#[test]
fn scanner_patch_proof_rejects_the_wrong_package_and_ambiguous_oci_layout() -> io::Result<()> {
    let root = TempDir::new()?;
    let library = root.path().join("lib");
    fs::create_dir(&library)?;
    fs::write(library.join("parse.js"), b"unpatched parser")?;
    let package = root.path().join("package.json");
    let input = json!({"directory": root.path()});
    fs::write(&package, br#"{"name":"picomatch","version":"4.0.6"}"#)?;
    assert!(
        execute("security-picomatch-image", input.clone())
            .unwrap_err()
            .to_string()
            .contains("picomatch identity")
    );
    fs::write(&package, br#"{"name":"picomatch","version":"4.0.7"}"#)?;
    assert!(
        execute("security-picomatch-image", input.clone())
            .unwrap_err()
            .to_string()
            .contains("parser digest")
    );

    let manifest = json!({
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "digest": format!("sha256:{}", "a".repeat(64)),
        "annotations": {"org.opencontainers.image.ref.name": "scan"},
    });
    let mut index = json!({"schemaVersion": 2, "manifests": [manifest]});
    let path = root.path().join("index.json");
    fs::write(&path, serde_json::to_vec(&index)?)?;
    assert!(execute("security-oci-scan-index", input.clone())?.is_null());
    index["manifests"] = json!([manifest, manifest]);
    fs::write(&path, serde_json::to_vec(&index)?)?;
    assert!(
        execute("security-oci-scan-index", input)
            .unwrap_err()
            .to_string()
            .contains("one OCI image manifest")
    );
    Ok(())
}

#[test]
fn patch_exemption_rejects_malformed_locks_and_scanner_identifiers() -> io::Result<()> {
    let root = TempDir::new()?;
    for lock in [
        json!([]),
        json!({"patchedDependencies": []}),
        json!({"patchedDependencies": {"picomatch@4.0.7": 42}}),
        json!({"packages":[]}),
        json!({"packages":{"picomatch":[null]}}),
    ] {
        assert!(
            execute(
                "security-picomatch-audit",
                json!({"root":root.path(),"lock":lock})
            )
            .is_err()
        );
    }

    let file = root.path().join("bun.lock");
    fs::write(&file, b"{ \"packages\": {}, }")?;
    assert_eq!(
        execute("security-bun-lock", json!({"root":root.path()}))?,
        "{ \"packages\": {}, }"
    );
    fs::write(&file, [255])?;
    assert!(
        execute("security-bun-lock", json!({"root":root.path()}))
            .unwrap_err()
            .to_string()
            .contains("UTF-8 Bun lockfile")
    );

    let digest = "a".repeat(64);
    assert_eq!(
        execute(
            "security-docker-id",
            json!({"kind":"container","value":digest})
        )?,
        true
    );
    assert_eq!(
        execute(
            "security-docker-id",
            json!({"kind":"image","value":format!("sha256:{digest}")})
        )?,
        true
    );
    assert_eq!(
        execute("security-docker-id", json!({"kind":"image","value":digest}))?,
        false
    );
    assert!(execute("security-docker-id", json!({"kind":"tag","value":digest})).is_err());
    assert_eq!(
        execute("security-picomatch-path", json!({}))?,
        "app/node_modules/.bun/picomatch@4.0.7/node_modules/picomatch"
    );
    Ok(())
}
