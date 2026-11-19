use marketplace_artifacts::digest;
use marketplace_tooling::contracts::execute;
use serde_json::json;
use std::fs;

#[test]
fn registry_generation_recreates_both_language_descriptors_and_rejects_drift() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let contract = root.join("contracts/v1");
    let rust = root.join("core/app-contracts/src/http");
    fs::create_dir_all(&contract).unwrap();
    fs::create_dir_all(&rust).unwrap();
    let registry = contract.join("http-operations.json");
    fs::write(
        &registry,
        include_bytes!("../../../contracts/v1/http-operations.json"),
    )
    .unwrap();
    execute("registry", json!({"root": root, "check": false})).unwrap();
    let types = contract.join("http-operations.generated.ts");
    assert_eq!(
        fs::read_to_string(&types).unwrap(),
        include_str!("../../../contracts/v1/http-operations.generated.ts").replace("\r\n", "\n")
    );
    assert_eq!(
        fs::read_to_string(rust.join("operations.rs")).unwrap(),
        include_str!("../../app-contracts/src/http/operations.rs").replace("\r\n", "\n")
    );
    execute("registry", json!({"root": root, "check": true})).unwrap();
    fs::write(&types, "unreviewed change").unwrap();
    assert!(
        execute("registry", json!({"root": root, "check": true}))
            .unwrap_err()
            .to_string()
            .contains("out of date")
    );
    let source = fs::read_to_string(&registry).unwrap();
    fs::write(
        &registry,
        source.replace("\"maxJsonDepth\": 64", "\"maxJsonDepth\": 0"),
    )
    .unwrap();
    assert!(execute("registry", json!({"root": root, "check": false})).is_err());
    assert_eq!(fs::read_to_string(types).unwrap(), "unreviewed change");
}

#[test]
fn invalid_sdk_documents_do_not_replace_valid_outputs_and_bundles_use_exact_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let contracts = root.join("contracts/v1");
    fs::create_dir_all(&contracts).unwrap();
    let initial = "{\"version\":1}\n";
    let mut request = json!({
        "root": root,
        "check": false,
        "documents": {"contracts.schema.json": initial, "openapi.json": initial}
    });
    execute("sync", request.clone()).unwrap();
    request["documents"]["contracts.schema.json"] = json!("{}");
    request["documents"]["openapi.json"] = json!("[]");
    assert!(execute("sync", request).is_err());
    assert_eq!(
        fs::read_to_string(contracts.join("contracts.schema.json")).unwrap(),
        initial
    );

    let files = [
        "LICENSE",
        "contracts.schema.json",
        "openapi.json",
        "rentnerproxy-app-contracts-1.0.0.tgz",
        "rentnerproxy-app-contracts-1.0.0.crate",
    ];
    for file in files {
        fs::write(root.join(file), file.as_bytes()).unwrap();
    }
    let input = json!({"directory": root, "version": "1.0.0", "sourceCommit": "a".repeat(40)});
    let output = execute("bundle", input.clone()).unwrap();
    for file in files {
        assert_eq!(output["sha256"][file], digest(file.as_bytes()));
    }
    fs::write(root.join("LICENSE"), []).unwrap();
    assert!(execute("bundle", input).is_err());
}
