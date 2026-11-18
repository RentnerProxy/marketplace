use marketplace_artifacts::digest;
use marketplace_tooling::oci::execute;
use serde_json::{Value, json};
use std::{fs, io};
use tar::{Builder, Header};
use tempfile::TempDir;

const TYPE: &str = "application/vnd.oci.image.manifest.v1+json";
const REVISION: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn append(archive: &mut Builder<Vec<u8>>, path: &str, bytes: &[u8]) -> io::Result<()> {
    let mut header = Header::new_ustar();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    archive.append_data(&mut header, path, bytes)
}

fn descriptor(bytes: &[u8]) -> Value {
    json!({ "digest": format!("sha256:{}", digest(bytes)), "size": bytes.len() })
}

fn blob(archive: &mut Builder<Vec<u8>>, original: &[u8], bytes: &[u8]) -> io::Result<()> {
    append(
        archive,
        &format!("blobs/sha256/{}", digest(original)),
        bytes,
    )
}

fn archive(layer_contents: &[u8], wrong_size: bool, shadow_index: bool) -> io::Result<Vec<u8>> {
    let layer = b"synthetic image layer";
    let config = serde_json::to_vec(&json!({
        "os": "linux",
        "architecture": "amd64",
        "rootfs": { "type": "layers", "diff_ids": [descriptor(layer)["digest"]] },
        "config": {
            "Healthcheck": { "Test": ["CMD", "container-healthcheck.sh"] },
            "Labels": {
                "org.opencontainers.image.revision": REVISION,
                "org.opencontainers.image.version": "dev-aaaaaaaaaaaa",
                "org.opencontainers.image.source": "https://github.com/RentnerProxy/marketplace",
                "org.opencontainers.image.title": "RentnerProxy Marketplace Dev",
            },
        },
    }))?;
    let mut layer_ref = descriptor(layer);
    if wrong_size {
        layer_ref["size"] = json!(layer.len() + 1);
    }
    let manifest = serde_json::to_vec(&json!({
        "schemaVersion": 2,
        "mediaType": TYPE,
        "config": descriptor(&config),
        "layers": [layer_ref],
    }))?;
    let mut manifest_ref = descriptor(&manifest);
    manifest_ref["mediaType"] = json!(TYPE);
    let index = serde_json::to_vec(&json!({
        "schemaVersion": 2,
        "manifests": [manifest_ref],
    }))?;

    let mut archive = Builder::new(Vec::new());
    // OCI producers may write the descriptors after their data.
    blob(&mut archive, layer, layer_contents)?;
    blob(&mut archive, &config, &config)?;
    blob(&mut archive, &manifest, &manifest)?;
    append(
        &mut archive,
        "oci-layout",
        br#"{"imageLayoutVersion":"1.0.0"}"#,
    )?;
    append(&mut archive, "index.json", &index)?;
    if shadow_index {
        append(&mut archive, "./index.json", &index)?;
    }
    archive.into_inner()
}

fn fixture(bytes: &[u8]) -> io::Result<(TempDir, Value)> {
    let root = TempDir::new()?;
    let directory = root.path().join("marketplace-dev-candidate");
    fs::create_dir(&directory)?;
    fs::write(directory.join("candidate-image.tar"), bytes)?;
    let input = json!({
        "command": "preflight",
        "temporary": root.path(),
        "directory": directory,
        "context": {
            "repository": "RentnerProxy/marketplace",
            "eventName": "workflow_dispatch",
            "ref": "refs/heads/main",
            "revision": REVISION,
            "workflowSha": REVISION,
            "workflowRef": "RentnerProxy/marketplace/.github/workflows/dev-image.yml@refs/heads/main",
            "runId": "53",
            "runAttempt": "1",
        }
    });
    Ok((root, input))
}

#[test]
fn sealed_archive_is_bound_to_the_tested_bytes() -> io::Result<()> {
    let bytes = archive(b"synthetic image layer", false, false)?;
    let (root, mut input) = fixture(&bytes)?;
    let tested_hash = execute("oci-dev", input.clone())?;
    assert_eq!(tested_hash, digest(&bytes));
    input["command"] = json!("seal");
    input["testedArchiveSha256"] = tested_hash.clone();
    let outputs = execute("oci-dev", input.clone())?;
    let receipt_bytes = fs::read(root.path().join("marketplace-dev-candidate/candidate.json"))?;
    let receipt = marketplace_artifacts::parse_json(&receipt_bytes)?;
    assert_eq!(outputs["evidence_sha256"], digest(&receipt_bytes));
    assert_eq!(outputs["archive_sha256"], tested_hash);
    assert_eq!(receipt["archiveSha256"], tested_hash);
    assert_eq!(receipt["immutableTag"], "dev-aaaaaaaaaaaa-53-1");
    assert_eq!(execute("oci-dev", input.clone())?, outputs);

    input["testedArchiveSha256"] = json!("b".repeat(64));
    assert!(
        execute("oci-dev", input)
            .unwrap_err()
            .to_string()
            .contains("changed after runtime verification")
    );
    Ok(())
}

#[test]
fn archive_rejects_substituted_blobs_bad_descriptor_sizes_duplicate_paths_and_trailing_data()
-> io::Result<()> {
    let mut appended = archive(b"synthetic image layer", false, false)?;
    appended.extend_from_slice(b"second payload");
    for (bytes, error) in [
        (
            archive(b"swapped image layer!!", false, false)?,
            "blob content",
        ),
        (
            archive(b"synthetic image layer", true, false)?,
            "descriptor size",
        ),
        (archive(b"synthetic image layer", false, true)?, "Duplicate"),
        (appended, "trailing data"),
    ] {
        let (_root, input) = fixture(&bytes)?;
        assert!(
            execute("oci-dev", input)
                .unwrap_err()
                .to_string()
                .contains(error)
        );
    }
    Ok(())
}

#[test]
fn publisher_requires_the_attested_handoff_assessment_and_both_registry_digests() -> io::Result<()>
{
    let bytes = archive(b"synthetic image layer", false, false)?;
    let (root, mut input) = fixture(&bytes)?;
    let directory = root.path().join("marketplace-dev-candidate");
    input["command"] = json!("seal");
    input["testedArchiveSha256"] = json!(digest(&bytes));
    let sealed = execute("oci-dev", input.clone())?;
    input["expectedArchiveSha256"] = sealed["archive_sha256"].clone();
    input["expectedEvidenceSha256"] = sealed["evidence_sha256"].clone();
    input["expectedDigest"] = sealed["digest"].clone();
    input["command"] = json!("hashes");
    assert!(execute("oci-dev", input.clone())?.is_null());

    input["command"] = json!("verify");
    assert!(execute("oci-dev", input.clone())?.is_null());
    let identity = marketplace_artifacts::parse_json(&fs::read(directory.join("identity.json"))?)?;
    assert_eq!(identity["digest"], sealed["digest"]);

    input["command"] = json!("ready");
    assert!(execute("oci-dev", input.clone()).is_err());
    input["command"] = json!("assess");
    input["timestamp"] = json!("2026-11-18T23:59:00.000Z");
    execute("oci-dev", input.clone())?;
    let assessment_path = directory.join("assessment.json");
    let assessment_bytes = fs::read(&assessment_path)?;
    let mut forged = marketplace_artifacts::parse_json(&assessment_bytes)?;
    forged["platforms"] = json!(["linux/arm64"]);
    fs::write(&assessment_path, serde_json::to_vec(&forged)?)?;
    input["command"] = json!("ready");
    assert!(
        execute("oci-dev", input.clone())
            .unwrap_err()
            .to_string()
            .contains("does not match")
    );
    fs::write(&assessment_path, assessment_bytes)?;
    assert_eq!(execute("oci-dev", input.clone())?, "dev-aaaaaaaaaaaa-53-1");

    input["command"] = json!("published");
    input["remote"] = json!({
        "immutable": sealed["digest"],
        "dev": format!("sha256:{}", "b".repeat(64)),
    });
    assert!(
        execute("oci-dev", input.clone())
            .unwrap_err()
            .to_string()
            .contains("do not match")
    );
    assert!(!directory.join("publication.json").exists());
    input["remote"]["dev"] = sealed["digest"].clone();
    execute("oci-dev", input.clone())?;
    let published =
        marketplace_artifacts::parse_json(&fs::read(directory.join("publication.json"))?)?;
    assert_eq!(published["tags"], json!(["dev-aaaaaaaaaaaa-53-1", "dev"]));
    assert_eq!(published["digest"], sealed["digest"]);

    fs::write(directory.join("candidate.json"), b"{}")?;
    input["command"] = json!("verify");
    assert!(
        execute("oci-dev", input)
            .unwrap_err()
            .to_string()
            .contains("artifact hash mismatch")
    );
    Ok(())
}
