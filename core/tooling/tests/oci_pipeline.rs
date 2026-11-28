use marketplace_tooling::oci::execute;
use rentnerproxy_artifacts::digest;
use serde_json::{Value, json};
use std::{fs, io};
use tar::{Builder, EntryType, Header};
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum ArchiveVariant {
    Normal,
    DirectoryEntries,
    WrongLayerSize,
    DuplicateIndex,
    MissingLayout,
    MissingIndex,
    WrongPlatform,
    MissingBlob,
    ExternalLayer,
    EmptyLayers,
    WrongLayerCount,
    OversizeIndex,
    UnsupportedEntry,
    UnexpectedPath,
}

fn archive(layer_contents: &[u8], variant: ArchiveVariant) -> io::Result<Vec<u8>> {
    let layer = b"synthetic image layer";
    let config = serde_json::to_vec(&json!({
        "os": "linux",
        "architecture": "amd64",
        "rootfs": { "type": "layers", "diff_ids": if variant == ArchiveVariant::WrongLayerCount { json!([]) } else { json!([descriptor(layer)["digest"]]) } },
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
    match variant {
        ArchiveVariant::WrongLayerSize => layer_ref["size"] = json!(layer.len() + 1),
        ArchiveVariant::MissingBlob => {
            layer_ref["digest"] = json!(format!("sha256:{}", "b".repeat(64)))
        }
        ArchiveVariant::ExternalLayer => {
            layer_ref["urls"] = json!(["https://example.invalid/layer"])
        }
        _ => {}
    }
    let manifest = serde_json::to_vec(&json!({
        "schemaVersion": 2,
        "mediaType": TYPE,
        "config": descriptor(&config),
        "layers": if variant == ArchiveVariant::EmptyLayers { json!([]) } else { json!([layer_ref]) },
    }))?;
    let mut manifest_ref = descriptor(&manifest);
    manifest_ref["mediaType"] = json!(TYPE);
    manifest_ref["platform"] = json!({"os": "linux", "architecture":
        if variant == ArchiveVariant::WrongPlatform { "arm64" } else { "amd64" }
    });
    let index = serde_json::to_vec(&json!({
        "schemaVersion": 2,
        "manifests": [manifest_ref],
    }))?;

    let mut archive = Builder::new(Vec::new());
    if variant == ArchiveVariant::DirectoryEntries {
        for path in ["blobs/", "blobs/sha256/"] {
            let mut header = Header::new_ustar();
            header.set_mode(0o755);
            header.set_entry_type(EntryType::Directory);
            header.set_size(0);
            archive.append_data(&mut header, path, io::empty())?;
        }
        append(&mut archive, "index.json", &index)?;
    }
    if variant == ArchiveVariant::UnsupportedEntry {
        let mut header = Header::new_ustar();
        header.set_entry_type(EntryType::Symlink);
        header.set_size(0);
        archive.append_link(&mut header, "alias", "oci-layout")?;
    }
    if variant == ArchiveVariant::UnexpectedPath {
        append(&mut archive, "foreign.json", b"{}")?;
    }
    // OCI producers may write descriptors either before or after their data.
    blob(&mut archive, layer, layer_contents)?;
    blob(&mut archive, &config, &config)?;
    blob(&mut archive, &manifest, &manifest)?;
    if variant != ArchiveVariant::MissingLayout {
        append(
            &mut archive,
            "oci-layout",
            br#"{"imageLayoutVersion":"1.0.0"}"#,
        )?;
    }
    match variant {
        ArchiveVariant::DirectoryEntries | ArchiveVariant::MissingIndex => {}
        ArchiveVariant::OversizeIndex => {
            append(&mut archive, "index.json", &vec![b' '; 1024 * 1024 + 1])?
        }
        _ => append(&mut archive, "index.json", &index)?,
    }
    if variant == ArchiveVariant::DuplicateIndex {
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
    let bytes = archive(b"synthetic image layer", ArchiveVariant::Normal)?;
    let (root, mut input) = fixture(&bytes)?;
    let tested_hash = execute("oci-dev", input.clone())?;
    assert_eq!(tested_hash, digest(&bytes));
    input["command"] = json!("seal");
    input["testedArchiveSha256"] = tested_hash.clone();
    let outputs = execute("oci-dev", input.clone())?;
    let receipt_bytes = fs::read(root.path().join("marketplace-dev-candidate/candidate.json"))?;
    let receipt = rentnerproxy_artifacts::parse_json(&receipt_bytes)?;
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
    let mut appended = archive(b"synthetic image layer", ArchiveVariant::Normal)?;
    appended.extend_from_slice(b"second payload");
    for (bytes, error) in [
        (
            archive(b"swapped image layer!!", ArchiveVariant::Normal)?,
            "blob content",
        ),
        (
            archive(b"synthetic image layer", ArchiveVariant::WrongLayerSize)?,
            "descriptor size",
        ),
        (
            archive(b"synthetic image layer", ArchiveVariant::DuplicateIndex)?,
            "Duplicate",
        ),
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
    let bytes = archive(b"synthetic image layer", ArchiveVariant::Normal)?;
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
    let identity = rentnerproxy_artifacts::parse_json(&fs::read(directory.join("identity.json"))?)?;
    assert_eq!(identity["digest"], sealed["digest"]);

    input["command"] = json!("ready");
    assert!(execute("oci-dev", input.clone()).is_err());
    input["command"] = json!("assess");
    input["timestamp"] = json!("2026-02-30T23:59:00.000Z");
    assert!(
        execute("oci-dev", input.clone())
            .unwrap_err()
            .to_string()
            .contains("canonical ISO timestamp")
    );
    input["timestamp"] = json!("2026-11-18T23:59:00.000Z");
    execute("oci-dev", input.clone())?;
    let assessment_path = directory.join("assessment.json");
    let assessment_bytes = fs::read(&assessment_path)?;
    input["command"] = json!("ready");
    fs::write(&assessment_path, b"{}")?;
    assert!(
        execute("oci-dev", input.clone())
            .unwrap_err()
            .to_string()
            .contains("Missing successful publisher assessment")
    );
    fs::write(&assessment_path, vec![b' '; 1024 * 1024 + 1])?;
    assert!(execute("oci-dev", input.clone()).is_err());
    let mut forged = rentnerproxy_artifacts::parse_json(&assessment_bytes)?;
    forged["platforms"] = json!(["linux/arm64"]);
    fs::write(&assessment_path, serde_json::to_vec(&forged)?)?;
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
        rentnerproxy_artifacts::parse_json(&fs::read(directory.join("publication.json"))?)?;
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

#[test]
fn archive_accepts_layout_directories_and_index_before_blob_records() -> io::Result<()> {
    let bytes = archive(b"synthetic image layer", ArchiveVariant::DirectoryEntries)?;
    let (_root, input) = fixture(&bytes)?;
    assert_eq!(execute("oci-dev", input)?, digest(&bytes));
    Ok(())
}

#[test]
fn rejects_unowned_tar_entries_and_invalid_layout_documents() -> io::Result<()> {
    for (variant, expected) in [
        (ArchiveVariant::UnsupportedEntry, "unsupported entry"),
        (ArchiveVariant::UnexpectedPath, "archive path"),
        (
            ArchiveVariant::MissingLayout,
            "missing its layout descriptor",
        ),
        (ArchiveVariant::MissingIndex, "missing its index"),
        (ArchiveVariant::WrongPlatform, "index platform"),
        (ArchiveVariant::MissingBlob, "refers to a missing blob"),
        (
            ArchiveVariant::ExternalLayer,
            "descriptor size or data source",
        ),
        (
            ArchiveVariant::EmptyLayers,
            "manifest is missing its layers",
        ),
        (ArchiveVariant::WrongLayerCount, "config layer count"),
        (
            ArchiveVariant::OversizeIndex,
            "document exceeds its size limit",
        ),
    ] {
        let bytes = archive(b"synthetic image layer", variant)?;
        let (_root, input) = fixture(&bytes)?;
        let message = execute("oci-dev", input).unwrap_err().to_string();
        assert!(message.contains(expected), "{message}");
    }
    let mut truncated = archive(b"synthetic image layer", ArchiveVariant::Normal)?;
    truncated.truncate(truncated.len() - 512);
    let (_root, input) = fixture(&truncated)?;
    assert!(
        execute("oci-dev", input)
            .unwrap_err()
            .to_string()
            .contains("Incomplete Dev OCI archive trailer")
    );
    Ok(())
}
