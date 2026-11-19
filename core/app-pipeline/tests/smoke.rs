use serde_json::{Value, json};
use std::process::{Command, Output, Stdio};

fn bootstrap(manifest: &Value, version: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_marketplace-app-pipeline"))
        .arg("smoke-bootstrap")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    serde_json::to_writer(
        child.stdin.take().unwrap(),
        &json!({"manifest": manifest, "version": version}),
    )
    .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn smoke_bootstrap_binds_contract_versions_and_socket_directions() {
    let mut manifest: Value = serde_json::from_str(include_str!(
        "../../../.github/scripts/ci/fixtures/app-candidate/v1/manifest.json"
    ))
    .unwrap();
    manifest["target"] = "linux-amd64".into();
    manifest["source"] = json!({"repositoryId":"8001234", "commit":"a".repeat(40)});

    let result = bootstrap(&manifest, "1.0.0");
    assert!(result.status.success());
    assert!(result.stderr.is_empty());
    let descriptor: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(descriptor["appId"], manifest["id"]);
    assert_eq!(
        descriptor["versions"],
        json!({"appProtocol": "1.0.0", "platformApi": "1.0.0", "uiBridge": "1.0.0"})
    );
    assert_eq!(descriptor["appSocket"], "/run-fixture/app/app.sock");
    assert_eq!(descriptor["coreSocket"], "/run-fixture/core/core.sock");
    let app = descriptor["appCredential"].as_str().unwrap();
    let core = descriptor["coreCredential"].as_str().unwrap();
    assert!(
        app.len() == 64 && core.len() == 64 && app != core,
        "expected different per-socket credentials"
    );

    let incompatible_version = bootstrap(&manifest, "2.0.0");
    manifest["requires"]["platformApi"] = ">=2.0.0 <3.0.0".into();
    let incompatible_manifest = bootstrap(&manifest, "1.0.0");
    for rejected in [incompatible_version, incompatible_manifest] {
        assert!(!rejected.status.success());
        assert!(rejected.stdout.is_empty());
        assert_eq!(
            String::from_utf8(rejected.stderr).unwrap().trim(),
            "Candidate is incompatible with its smoke runtime"
        );
    }
}
