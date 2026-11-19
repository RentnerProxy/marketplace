use std::fs;

use marketplace_tooling::project::execute;
use serde_json::json;

#[test]
fn rendering_keeps_crlf_and_rejects_unknown_documentation_markers() {
    let config = json!({
        "defaultName": "A & B <Portal>",
        "id": "portal",
        "packageName": "portal_web",
        "databaseName": "portal_data",
        "databaseSchema": "portal_schema",
        "databaseRole": "portal_runtime",
        "imageRepository": "registry.example.test/team/portal",
    });
    let compose = "services:\r\n    old:\r\n        image: registry.example.test:5000/team/old:v1.2.3\r\n        volumes:\r\n          - old_data:/data\r\nvolumes:\r\n    old_data:\r\n";
    let rendered = execute(
        "render",
        json!({"file": "docker-compose.yml", "content": compose, "config": config}),
    )
    .unwrap();
    assert_eq!(
        rendered,
        "services:\r\n    portal:\r\n        image: registry.example.test/team/portal:v1.2.3\r\n        volumes:\r\n          - portal_data:/data\r\nvolumes:\r\n    portal_data:\r\n"
    );
    let readme = "<!-- project:defaultName -->old<!-- /project -->\r\n";
    assert_eq!(
        execute(
            "render",
            json!({"file": "README.md", "content": readme, "config": config})
        )
        .unwrap(),
        "<!-- project:defaultName -->A &amp; B &lt;Portal&gt;<!-- /project -->\r\n"
    );
    let wrong_marker = "<!-- project:constructor -->bad<!-- /project -->";
    let error = execute(
        "render",
        json!({"file": "README.md", "content": wrong_marker, "config": config}),
    )
    .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Unbekanntes Projektfeld in der Dokumentation: constructor"
    );
}

#[cfg(unix)]
#[test]
fn applying_a_plan_never_follows_a_substituted_file_symlink() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("repository");
    fs::create_dir(&root).unwrap();
    let external = directory.path().join("external.json");
    fs::write(&external, "reviewed").unwrap();
    let target = root.join("package.json");
    symlink(&external, &target).unwrap();
    let result = execute(
        "apply",
        json!({
            "root": root,
            "changes": [{"file": "package.json", "path": target, "before": "reviewed", "after": "changed"}],
        }),
    );
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("regulärer Repositorypfad")
    );
    assert_eq!(fs::read_to_string(external).unwrap(), "reviewed");
}

#[test]
fn apply_preflights_all_files_before_writing_and_preserves_external_edits() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let package = root.join("package.json");
    let lock = root.join("bun.lock");
    fs::write(&package, "original package").unwrap();
    fs::write(&lock, "intervening edit").unwrap();
    let mut plan = json!({
        "root": root,
        "changes": [
            {"file": "package.json", "path": package, "before": "original package", "after": "updated package"},
            {"file": "bun.lock", "path": lock, "before": "original lock", "after": "updated lock"},
        ],
    });
    let result = execute("apply", plan.clone());
    assert!(result.unwrap_err().to_string().contains("zwischenzeitlich"));
    assert_eq!(fs::read_to_string(&package).unwrap(), "original package");
    assert_eq!(fs::read_to_string(&lock).unwrap(), "intervening edit");
    assert_eq!(fs::read_dir(root).unwrap().count(), 2);

    plan["changes"][1]["before"] = json!("intervening edit");
    let mut duplicate = plan.clone();
    duplicate["changes"][1] = plan["changes"][0].clone();
    assert!(
        execute("apply", duplicate)
            .unwrap_err()
            .to_string()
            .contains("mehrfach")
    );
    assert_eq!(fs::read_to_string(&package).unwrap(), "original package");

    assert_eq!(execute("apply", plan).unwrap(), serde_json::Value::Null);
    assert_eq!(fs::read_to_string(package).unwrap(), "updated package");
    assert_eq!(fs::read_to_string(lock).unwrap(), "updated lock");
    assert_eq!(fs::read_dir(root).unwrap().count(), 2);
}
