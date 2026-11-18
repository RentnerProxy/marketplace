use std::{fs, path::Path};

use marketplace_app_pipeline::evidence::execute;
use marketplace_artifacts::file_identity;
use serde_json::{Value, json};

const MANIFEST: &str = include_str!("../../../contracts/v1/fixtures.json");

fn create_seals(directory: &Path) -> (Value, Value, Value) {
    let fixture: Value = serde_json::from_str(MANIFEST).unwrap();
    let build = json!({
        "repositoryId": "1234",
        "workflowCommit": "4".repeat(40),
        "workflowPath": ".github/workflows/app-candidate.yml",
        "runId": "5678",
        "attempt": 1,
    });
    let sbom = directory.join("original-sbom.json");
    fs::write(&sbom, br#"{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"components":[{"type":"application","name":"monitoring"}]}"#).unwrap();
    let mut records = Vec::new();
    for (target, path) in [("linux-amd64", "amd64"), ("linux-arm64", "arm64")] {
        let archive = directory.join(format!("{target}-original.tar.zst"));
        // Evidence treats the archive bytes as opaque.
        fs::write(&archive, format!("tested archive bytes for {target}")).unwrap();
        let mut manifest = fixture["manifest"].clone();
        manifest["target"] = json!(target);
        let options = json!({
            "outputDirectory": directory.join(path),
            "archivePath": archive,
            "sbomPath": sbom,
            "manifest": manifest,
            "manifestSha256": marketplace_artifacts::digest(format!("manifest-{target}").as_bytes()),
            "build": build,
            "purpose": "candidate",
            "applianceImage": format!("ghcr.io/rentnerproxy/marketplace@sha256:{}", "5".repeat(64)),
        });
        let record = execute("seal-target", options.clone()).unwrap();
        assert_eq!(execute("seal-target", options).unwrap(), record);
        records.push(record);
    }
    let mut assembly = json!({
        "source": fixture["manifest"]["source"],
        "build": build,
        "purpose": "candidate",
        "publisherName": "RentnerProxy",
    });
    let mut seal = assembly.clone();
    seal["outputDirectory"] = json!(directory.join("candidate"));
    seal["targetDirectories"] = json!({
        "linux-amd64": directory.join("amd64"),
        "linux-arm64": directory.join("arm64"),
    });
    assembly["records"] = json!(records);
    let artifact = json!({ "id": "89765", "sha256": "a".repeat(64) });
    let mut receipt = artifact.clone();
    receipt["expiresAt"] = json!("2026-11-20T00:00:00.000Z");
    receipt["expired"] = json!(false);
    let handoff = json!({
        "directory": directory.join("candidate"),
        "source": fixture["manifest"]["source"],
        "build": build,
        "artifact": receipt,
        "downloadedArtifact": artifact,
        "now": 1_795_046_400_000_i64,
    });
    (seal, assembly, handoff)
}

#[test]
fn legacy_candidate_bytes_and_review_identity_are_stable() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let (seal, assembly, handoff) = create_seals(path);
    let result = execute("seal-candidate", seal.clone()).unwrap();
    assert_eq!(execute("seal-candidate", seal).unwrap(), result);
    assert_eq!(execute("verify-handoff", handoff).unwrap(), result);
    let review = execute("assemble", assembly).unwrap();
    assert_eq!(review["sealed"], result);
    assert_eq!(
        review["reportBytes"].as_str().unwrap().as_bytes(),
        fs::read(path.join("candidate/validation-report.json")).unwrap(),
    );

    // Captured from the TypeScript implementation for the same two targets.
    assert_eq!(
        result["id"],
        "550a0169e12ec3f51d5de220824858187040d786076faf3cf38e756960cab1d9"
    );
    assert_eq!(
        result["evidence"]["report"],
        json!({
            "sha256": "a46b3cf52f48df40c6faf91f7e429c49d24a582fca5a9a0acfbfbd7094450481",
            "sizeBytes": 6_878,
        })
    );
    for (relative, size, sha) in [
        (
            "candidate/candidate.json",
            6_613,
            "ea800d7b6e30ff2c53f6dfc43c78b08077e905d13fe315a918e40259df6dc937",
        ),
        (
            "amd64/target.json",
            2_953,
            "e3407b50ef4e4fccc5939d51364f9a9dbf051a72a068a0ad6599d77eaa9b13f6",
        ),
    ] {
        let identity = file_identity(&path.join(relative), 512 * 1024).unwrap();
        assert_eq!((identity.size_bytes, identity.sha256.as_str()), (size, sha));
    }
    assert_eq!(fs::read_dir(path.join("candidate")).unwrap().count(), 8);
}

#[test]
fn evidence_fails_closed_on_rebinding_and_tampering() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let (seal, assembly, handoff) = create_seals(path);
    execute("seal-candidate", seal).unwrap();
    let mut wrong_run = assembly;
    wrong_run["build"]["attempt"] = json!(2);
    assert!(
        execute("assemble", wrong_run)
            .unwrap_err()
            .to_string()
            .contains("mismatch")
    );

    let mut expired = handoff.clone();
    expired["now"] = json!(1_795_132_800_000_i64);
    assert!(
        execute("verify-handoff", expired)
            .unwrap_err()
            .to_string()
            .contains("expired")
    );

    let candidate = path.join("candidate/candidate.json");
    let sealed = fs::read(&candidate).unwrap();
    let noncanonical =
        serde_json::to_vec(&serde_json::from_slice::<Value>(&sealed).unwrap()).unwrap();
    fs::write(&candidate, noncanonical).unwrap();
    assert!(
        execute("verify-handoff", handoff.clone())
            .unwrap_err()
            .to_string()
            .contains("canonical seal")
    );
    fs::write(&candidate, sealed).unwrap();

    let handoff_directory = path.join("candidate");
    let archive = fs::read_dir(&handoff_directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.to_str().unwrap().ends_with("linux-amd64.tar.zst"))
        .unwrap();
    let mut modified = fs::read(&archive).unwrap();
    modified[0] ^= 1;
    fs::write(archive, modified).unwrap();
    assert!(
        execute("verify-handoff", handoff)
            .unwrap_err()
            .to_string()
            .contains("digest or length mismatch")
    );
}

#[test]
fn resealed_provenance_must_describe_the_exact_target() {
    let directory = tempfile::tempdir().unwrap();
    let (seal, _, _) = create_seals(directory.path());
    let target = directory.path().join("amd64");
    let provenance = fs::read_dir(&target)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.to_str().unwrap().ends_with(".provenance.json"))
        .unwrap();
    let original = fs::read_to_string(&provenance).unwrap();
    let replacement = original.replacen("\"formatVersion\": 1", "\"formatVersion\": 2", 1);
    assert_ne!(original, replacement);
    assert_eq!(original.len(), replacement.len());
    fs::write(&provenance, &replacement).unwrap();
    let metadata = target.join("target.json");
    let canonical = fs::read_to_string(&metadata).unwrap();
    let replacement_digest = marketplace_artifacts::digest(replacement.as_bytes());
    let original_digest = marketplace_artifacts::digest(original.as_bytes());
    fs::write(
        &metadata,
        canonical.replacen(&original_digest, &replacement_digest, 1),
    )
    .unwrap();

    assert!(
        execute("seal-candidate", seal)
            .unwrap_err()
            .to_string()
            .contains("provenance does not match")
    );
    assert!(!directory.path().join("candidate").exists());
}

#[test]
fn incomplete_seal_cleans_temporary_files_and_preserves_conflicting_output() {
    let directory = tempfile::tempdir().unwrap();
    let (seal, _, handoff) = create_seals(directory.path());
    let candidate = directory.path().join("candidate");
    fs::create_dir(&candidate).unwrap();
    let report = candidate.join("validation-report.json");
    fs::write(&report, b"existing report").unwrap();
    assert!(
        execute("seal-candidate", seal.clone())
            .unwrap_err()
            .to_string()
            .contains("digest or length mismatch")
    );
    assert_eq!(fs::read(&report).unwrap(), b"existing report");
    assert!(!candidate.join("candidate.json").exists());
    assert_eq!(fs::read_dir(&candidate).unwrap().count(), 7);

    fs::remove_file(report).unwrap();
    let sealed = execute("seal-candidate", seal).unwrap();
    assert_eq!(execute("verify-handoff", handoff).unwrap(), sealed);
    assert_eq!(fs::read_dir(&candidate).unwrap().count(), 8);
}

#[test]
fn evidence_file_apis_preserve_exact_bytes_and_reject_aliases() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("metadata.json");
    let canonical = "\u{feff}{\"formatVersion\":1}\n";
    let identity = json!({
        "sha256": marketplace_artifacts::digest(canonical.as_bytes()),
        "sizeBytes": canonical.len(),
    });
    fs::write(&path, canonical).unwrap();
    let input = json!({"path": path, "limit": 512, "expected": identity});
    assert_eq!(execute("file-identity", input.clone()).unwrap(), identity);
    assert_eq!(
        execute("read-json", input.clone()).unwrap(),
        json!({"bytes": canonical, "value": {"formatVersion":1}})
    );

    let aliased = directory.path().join("alias.json");
    fs::hard_link(&path, &aliased).unwrap();
    assert!(execute("read-json", input).is_err());
    fs::remove_file(aliased).unwrap();
    fs::write(&path, b"{\"name\":1,\"name\":2}").unwrap();
    assert!(execute("read-json", json!({"path": path, "limit": 512})).is_err());
    fs::write(&path, b"").unwrap();
    assert!(execute("file-identity", json!({"path": path, "limit": 512})).is_err());
}
