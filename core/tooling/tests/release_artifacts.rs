use marketplace_artifacts::digest;
use marketplace_tooling::{release, security};
use serde_json::json;
use std::{fs, io};
use tempfile::TempDir;

#[test]
fn release_changelog_admits_only_the_prepared_immutable_asset() -> io::Result<()> {
    let directory = TempDir::new()?;
    let tag = "v1.0.0-alpha.1";
    let asset = "Marketplace-v1.0.0-alpha.1-CHANGELOG.md";
    let source = directory.path().join(asset);
    let downloaded = directory.path().join("downloaded.md");
    let mut input = json!({ "tag": tag, "directory": directory.path() });

    assert!(release::execute("release-changelog", input.clone()).is_err());
    fs::write(&source, b"prepared\n")?;
    assert_eq!(release::execute("release-changelog", input.clone())?, asset);
    fs::write(&downloaded, b"prepared\n")?;
    input["published"] = json!(downloaded);
    assert_eq!(release::execute("release-changelog", input.clone())?, asset);
    fs::write(&downloaded, b"prepared\r\n")?;
    assert!(
        release::execute("release-changelog", input)
            .unwrap_err()
            .to_string()
            .contains("refusing to overwrite")
    );
    Ok(())
}

#[test]
fn checksum_accepts_only_the_declared_digest_and_regular_file() -> io::Result<()> {
    let directory = TempDir::new()?;
    let bytes = b"checksum fixture";
    let path = directory.path().join("archive");
    fs::write(&path, bytes)?;
    let mut input = json!({ "path": path, "expected": digest(bytes) });
    security::execute("security-checksum", input.clone())?;
    input["expected"] = json!(format!("{}\n", digest(bytes)));
    assert!(security::execute("security-checksum", input.clone()).is_err());
    input["expected"] = json!(digest(bytes));
    fs::write(&path, b"substituted content")?;
    assert!(security::execute("security-checksum", input.clone()).is_err());
    input["path"] = json!(directory.path());
    assert!(security::execute("security-checksum", input).is_err());
    Ok(())
}

#[test]
fn retries_check_the_existing_image_config_and_channel_digest() -> io::Result<()> {
    let directory = TempDir::new()?;
    let path = directory.path().join("manifest.json");
    let image_id = format!("sha256:{}", "a".repeat(64));
    let candidate = json!({ "path": path, "imageId": image_id });
    fs::write(
        &path,
        serde_json::to_vec(&json!({ "config": { "digest": image_id } }))?,
    )?;
    assert!(release::execute("release-existing-image", candidate.clone())?.is_null());

    let different = format!("sha256:{}", "b".repeat(64));
    fs::write(
        &path,
        serde_json::to_vec(&json!({ "config": { "digest": different } }))?,
    )?;
    assert!(
        release::execute("release-existing-image", candidate.clone())
            .unwrap_err()
            .to_string()
            .contains("refusing overwrite")
    );
    fs::write(&path, b"not a manifest")?;
    assert!(release::execute("release-existing-image", candidate).is_err());

    let reference = format!("ghcr.io/rentnerproxy/marketplace@{image_id}");
    let mut inputs = json!({ "versionDigest": image_id, "channelDigest": image_id });
    assert_eq!(
        release::execute("release-published-image", inputs.clone())?,
        reference
    );
    inputs["channelDigest"] = json!(different);
    assert!(
        release::execute("release-published-image", inputs)
            .unwrap_err()
            .to_string()
            .contains("does not match")
    );
    assert!(release::execute("release-image-reference", json!({"image": reference}))?.is_null());
    assert!(
        release::execute(
            "release-image-reference",
            json!({"image": "ghcr.io/rentnerproxy/marketplace:latest"})
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn publication_requires_the_same_remote_tag_and_containment_in_main() -> io::Result<()> {
    let revision = "a".repeat(40);
    let mut input = json!({
        "tag": "v1.2.3-rc.1", "repository": "RentnerProxy/marketplace", "refType": "tag",
        "revision": revision, "localRevision": revision, "remoteRevision": revision, "comparison": "ahead",
    });
    assert!(release::execute("release-tag-context", input.clone())?.is_null());
    assert!(release::execute("release-tag-provenance", input.clone())?.is_null());
    input["comparison"] = json!("identical");
    assert!(release::execute("release-tag-provenance", input.clone())?.is_null());
    input["comparison"] = json!("diverged");
    assert!(
        release::execute("release-tag-provenance", input.clone())
            .unwrap_err()
            .to_string()
            .contains("main does not contain")
    );
    input["remoteRevision"] = json!("b".repeat(40));
    assert!(
        release::execute("release-tag-provenance", input.clone())
            .unwrap_err()
            .to_string()
            .contains("Remote Marketplace tag")
    );
    input["localRevision"] = input["remoteRevision"].clone();
    assert!(
        release::execute("release-tag-context", input.clone())
            .unwrap_err()
            .to_string()
            .contains("checkout must match")
    );
    input["refType"] = json!("branch");
    assert!(
        release::execute("release-tag-context", input)
            .unwrap_err()
            .to_string()
            .contains("official Marketplace tagged revision")
    );
    Ok(())
}
