use std::fs;

use marketplace_app_pipeline::{dependency, sbom, source};
use serde_json::{Value, json};

#[test]
fn source_checks_exact_tree_budget_and_committed_file_types() {
    let root = "a".repeat(40);
    let blob = "b".repeat(40);
    let input = json!({
        "expectedTree": root,
        "tree": {
            "sha": root,
            "truncated": false,
            "tree": [
                { "type": "tree", "sha": "c".repeat(40) },
                { "type": "blob", "sha": blob, "size": 1 },
                { "type": "blob", "sha": blob, "size": 1 },
            ],
        },
    });
    assert_eq!(
        source::execute("tree", input.clone()).unwrap(),
        json!([blob])
    );
    let mut oversized = input.clone();
    oversized["tree"]["tree"][1]["size"] = json!(64 * 1024 * 1024);
    assert!(
        source::execute("tree", oversized)
            .unwrap_err()
            .to_string()
            .contains("byte budget")
    );
    let mut truncated = input;
    truncated["tree"]["truncated"] = json!(true);
    assert!(source::execute("tree", truncated).is_err());

    let directory =
        json!({ "entry": format!("040000 tree {root}\tapps/app\0"), "path": "apps/app" });
    assert_eq!(source::execute("directory", directory).unwrap(), root);
    let executable =
        json!({ "entry": format!("100755 blob {blob}\tpackage.json\n"), "name": "package.json" });
    assert_eq!(
        source::execute("staged-file", executable).unwrap(),
        json!({"present": true, "limit": 1_048_576})
    );
    let symlink = json!({ "entry": format!("120000 blob {blob}\tbun.lock\n"), "name": "bun.lock" });
    assert!(source::execute("staged-file", symlink).is_err());
}

#[test]
fn rejects_incomplete_tree_receipts_and_mismatched_git_paths() {
    let root = "a".repeat(40);
    let blob = "b".repeat(40);
    let missing_size = json!({"type": "blob", "sha": blob});
    let receipt = json!({"sha": root, "truncated": false, "tree": [missing_size]});
    assert!(
        source::execute("tree", json!({"expectedTree": blob, "tree": receipt}))
            .unwrap_err()
            .to_string()
            .contains("identity changed")
    );
    assert!(
        source::execute("tree", json!({"expectedTree": root, "tree": receipt}))
            .unwrap_err()
            .to_string()
            .contains("blob size")
    );
    let invalid_entry = json!({"type": "blob", "sha": blob.to_uppercase(), "size": 1});
    let receipt = json!({"sha": root, "truncated": false, "tree": [invalid_entry]});
    assert!(
        source::execute("tree", json!({"expectedTree": root, "tree": receipt}))
            .unwrap_err()
            .to_string()
            .contains("GitHub tree entry")
    );

    let outside = format!("040000 tree {root}\tapps/../outside\0");
    assert!(
        source::execute(
            "directory",
            json!({"entry": outside, "path": "apps/../outside"})
        )
        .is_err()
    );
    let wrong_file = format!("100644 blob {blob}\tprivate.json\n");
    assert!(
        source::execute(
            "staged-file",
            json!({"entry": wrong_file, "name": "package.json"})
        )
        .is_err()
    );
    let lock_absent =
        source::execute("staged-file", json!({"entry": "", "name": "bun.lock"})).unwrap();
    assert_eq!(
        lock_absent,
        json!({"present": false, "limit": 8 * 1024 * 1024})
    );
    assert!(source::execute("staged-file", json!({"entry": "", "name": "package.json"})).is_err());
}

#[test]
fn admits_only_sanitized_script_free_npm_dependency_inputs() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let package = br#"{"name":"example","scripts":{"build":"bun build.ts","postinstall":"ignored"},"devDependencies":{"@scope/library":"^1.0.0"},"trustedDependencies":["@scope/library"]}"#;
    let lock = br#"{
        // Frozen Bun-generated text lock
        "lockfileVersion": 3,
        "workspaces": { "": { "devDependencies": { "@scope/library": "^1.0.0", }, }, },
        "packages": {
            "@scope/library": ["@scope/library@1.2.3", "https://registry.npmjs.org/@scope/library/-/library-1.2.3.tgz", { /* no scripts */ "bin": "cli.js", "trusted": true, }, "sha512-ABC+/=",],
        },
    }"#;
    fs::write(path.join("package.json"), package).unwrap();
    fs::write(path.join("bun.lock"), lock).unwrap();
    let output = path.join("out");
    let input = json!({"directory": path, "outputDirectory": output});
    let result = dependency::execute("admit", input.clone()).unwrap();
    assert_eq!(result["hasDependencies"], true);
    assert_eq!(
        result["packageSha256"],
        marketplace_artifacts::digest(package)
    );
    assert_eq!(result["lockSha256"], marketplace_artifacts::digest(lock));
    let admitted: Value =
        serde_json::from_slice(&fs::read(output.join("package.json")).unwrap()).unwrap();
    assert_eq!(
        admitted,
        json!({"name": "example", "devDependencies": { "@scope/library": "^1.0.0" }})
    );
    let admitted: Value =
        serde_json::from_slice(&fs::read(output.join("bun.lock")).unwrap()).unwrap();
    assert_eq!(
        admitted["packages"]["@scope/library"][2],
        json!({"bin": "cli.js"})
    );

    let malicious = std::str::from_utf8(lock)
        .unwrap()
        .replace("registry.npmjs.org", "registry.example.invalid");
    fs::write(path.join("bun.lock"), malicious).unwrap();
    let mut rejected = input;
    let unused = path.join("rejected");
    rejected["outputDirectory"] = json!(unused);
    assert!(
        dependency::execute("admit", rejected.clone())
            .unwrap_err()
            .to_string()
            .contains("public npm registry")
    );
    assert!(!unused.exists());
    let duplicate = std::str::from_utf8(lock).unwrap().replacen(
        "\"lockfileVersion\": 3,",
        "\"lockfileVersion\": 3, \"lockfileVersion\": 3,",
        1,
    );
    fs::write(path.join("bun.lock"), duplicate).unwrap();
    assert_eq!(
        dependency::execute("admit", rejected)
            .unwrap_err()
            .to_string(),
        "Duplicate JSON member",
    );
    assert!(!unused.exists());
}

#[test]
fn staged_dependency_failures_leave_output_uncreated() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let output = root.join("out");
    let input = json!({"directory": root, "outputDirectory": output});
    let package = root.join("package.json");
    let lock = root.join("bun.lock");
    fs::write(&package, br#"{"scripts":{"build":"bun run build.ts"}}"#).unwrap();
    let no_dependencies = dependency::execute("admit", input.clone()).unwrap();
    assert_eq!(no_dependencies["hasDependencies"], false);
    assert!(no_dependencies.get("lockSha256").is_none());
    assert!(!output.exists());

    fs::write(&lock, b"").unwrap();
    let optional = dependency::execute("admit", input.clone()).unwrap();
    assert_eq!(optional["lockSha256"], marketplace_artifacts::digest(&[]));
    fs::remove_file(&lock).unwrap();
    fs::write(
        &package,
        br#"{"scripts":{"build":"bun run build.ts"},"dependencies":{"library":"^1.2.0"}}"#,
    )
    .unwrap();
    assert!(
        dependency::execute("admit", input.clone())
            .unwrap_err()
            .to_string()
            .contains("frozen bun.lock")
    );
    assert!(!output.exists());

    for (invalid_lock, reason) in [
        (
            r#"{"lockfileVersion":1,"workspaces":{"":{}},"packages":{}}"#,
            "lockfile version",
        ),
        (
            r#"{"lockfileVersion":2,"workspaces":{"":{},"local":{}},"packages":{}}"#,
            "single root workspace",
        ),
        (
            r#"{"lockfileVersion":2,"configVersion":4,"workspaces":{"":{}},"packages":{}}"#,
            "lockfile configuration",
        ),
        (
            r#"{"lockfileVersion":2,"workspaces":{"":{}},"packages":{"library":["library@1.2.0","",{},"none"]}}"#,
            "lock entry",
        ),
        (
            r#"{"lockfileVersion":2,"workspaces":{"":{}},"packages":{"library":["library@1.2.0","",{}]}}"#,
            "lock entry",
        ),
        (
            r#"{"lockfileVersion":2, /* not closed"#,
            "Unterminated Bun lock comment",
        ),
    ] {
        fs::write(&lock, invalid_lock).unwrap();
        assert!(
            dependency::execute("admit", input.clone())
                .unwrap_err()
                .to_string()
                .contains(reason)
        );
        assert!(!output.exists());
    }
    let valid_lock = br#"{"lockfileVersion":2.0,"configVersion":1.0,"workspaces":{"":{}},"packages":{"library":["library@1.2.0","",{"os":["linux"],"cpu":"x64","libc":"glibc","bundled":false,"optionalPeers":["peer"],"bin":{"library":"bin.js"}},"sha256-abc"]}}"#;
    fs::write(&lock, valid_lock).unwrap();
    dependency::execute("admit", input).unwrap();
    let stored: Value =
        serde_json::from_slice(&fs::read(output.join("bun.lock")).unwrap()).unwrap();
    assert_eq!(stored["lockfileVersion"], 2);
    assert_eq!(stored["configVersion"], 1);
    assert_eq!(
        stored["packages"]["library"][2]["optionalPeers"],
        json!(["peer"])
    );
}

#[test]
fn scanner_normalization_preserves_bom_references_and_exact_member_order() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("sbom.json");
    fs::write(
        directory.path().join("package.json"),
        br#"{"devDependencies":{"locked":"^1"}}"#,
    )
    .unwrap();
    let scanner = br#"{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"metadata":{"component":{"type":"application","name":"/tmp/app","bom-ref":"root"},"timestamp":"now"},"components":[{"type":"library","name":"locked","bom-ref":"locked"}],"dependencies":[{"ref":"root","dependsOn":["locked"]}]}"#;
    fs::write(&path, scanner).unwrap();
    let input = json!({
        "path": path,
        "manifest": { "id": "publisher.app", "version": "1.2.3", "display": { "license": "MIT" } },
        "dependenciesDirectory": directory.path(),
    });
    sbom::execute("normalize-file", input.clone()).unwrap();
    let expected = concat!(
        r#"{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"components":[{"type":"library","name":"locked","bom-ref":"locked"}],"dependencies":[{"ref":"root","dependsOn":["locked"]}],"metadata":{"component":{"type":"application","name":"publisher.app","bom-ref":"root","version":"1.2.3","licenses":[{"license":{"name":"MIT"}}]},"timestamp":"now"}}"#,
        "\n"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), expected);

    let empty = br#"{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"components":[]}"#;
    fs::write(&path, empty).unwrap();
    assert!(
        sbom::execute("normalize-file", input)
            .unwrap_err()
            .to_string()
            .contains("inventory is empty")
    );
    assert_eq!(fs::read(path).unwrap(), empty);
}

#[test]
fn sbom_counts_nested_components_and_rejects_ambiguous_scanner_output() {
    let normalize = |input: Value| {
        sbom::execute(
            "normalize",
            json!({
                "input": input,
                "manifest": {"id": "publisher.app", "version": "1.2.3", "display": {"license": "MIT"}},
                "hasDependencies": false,
            }),
        )
    };
    let root_only = json!({"bomFormat": "CycloneDX", "specVersion": "1.6", "version": 1});
    let normalized = normalize(root_only.clone()).unwrap();
    assert_eq!(normalized["components"], json!([]));
    assert_eq!(normalized["metadata"]["component"]["type"], "application");

    let mut invalid = root_only.clone();
    invalid["services"] = json!("not an inventory");
    assert!(
        normalize(invalid)
            .unwrap_err()
            .to_string()
            .contains("SBOM list")
    );
    let mut invalid = root_only.clone();
    invalid["components"] = json!([{"type": "library", "name": ""}]);
    assert!(
        normalize(invalid)
            .unwrap_err()
            .to_string()
            .contains("SBOM component")
    );
    let mut invalid = root_only;
    let leaf = json!({"type": "library", "name": "child"});
    invalid["components"] =
        json!([{"type": "library", "name": "parent", "components": vec![leaf; 16_383]}]);
    assert!(
        normalize(invalid)
            .unwrap_err()
            .to_string()
            .contains("too many components")
    );

    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("package.json"), b"{}").unwrap();
    let path = directory.path().join("sbom.json");
    let duplicate = b"{\"bomFormat\":\"CycloneDX\",\"bomFormat\":\"CycloneDX\",\"version\":1,\"specVersion\":\"1.6\"}";
    fs::write(&path, duplicate).unwrap();
    let result = sbom::execute(
        "normalize-file",
        json!({
            "path": path,
            "manifest": {"id": "publisher.app", "version": "1.2.3", "display": {"license": "MIT"}},
            "dependenciesDirectory": directory.path(),
        }),
    );
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("Duplicate JSON member")
    );
    assert_eq!(fs::read(&path).unwrap(), duplicate);
}

#[test]
fn scanner_preserves_javascript_member_order_for_extension_objects() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("sbom.json");
    fs::write(directory.path().join("package.json"), b"{}").unwrap();
    let source = concat!(
        "\u{feff}",
        r#"{"specVersion":"1.6","extra":{"10":null,"2":false,"01":"first","+1":"second","4294967295":"third","0":-4,"4294967294":4.25,"value":"\u00fc","numbers":[1e-6,-1e-6,1e-7,1e21,1000000000000000101,-1000000000000000101,333333333.33333329,1.0000000000000007]},"version":1.0,"bomFormat":"CycloneDX"}"#,
    );
    fs::write(&path, source).unwrap();
    sbom::execute(
        "normalize-file",
        json!({
            "path": path,
            "manifest": {"id": "publisher.app", "version": "1.2.3", "display": {"license": "MIT"}},
            "dependenciesDirectory": directory.path(),
        }),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        concat!(
            r#"{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"extra":{"0":-4,"2":false,"10":null,"4294967294":4.25,"01":"first","+1":"second","4294967295":"third","value":"ü","numbers":[0.000001,-0.000001,1e-7,1e+21,1000000000000000100,-1000000000000000100,333333333.3333333,1.0000000000000007]},"components":[],"metadata":{"component":{"type":"application","name":"publisher.app","version":"1.2.3","licenses":[{"license":{"name":"MIT"}}]}}}"#,
            "\n",
        )
    );
}
