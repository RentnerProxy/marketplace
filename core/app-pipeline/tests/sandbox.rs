use marketplace_app_pipeline::sandbox;
use serde_json::json;

#[test]
fn sandbox_adapters_require_owned_containers_and_read_only_mounts() {
    let name = "marketplace-candidate-11111111-1111-4111-8111-111111111111";
    for args in [
        json!(["rm", "--force", "--volumes", name, "unrelated-fixture"]),
        json!(["start", "unrelated-fixture", name]),
        json!(["exec", "--user", "root", name, "/usr/bin/true"]),
    ] {
        let error = sandbox::execute("docker", json!({ "args": args })).unwrap_err();
        assert_eq!(error.to_string(), "Invalid candidate Docker operation");
    }
    assert!(
        sandbox::execute(
            "mount",
            json!({"source": "relative-package", "destination": "/package"})
        )
        .is_err()
    );
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().to_str().unwrap();
    assert_eq!(
        sandbox::execute(
            "mount",
            json!({"source": source, "destination": "/package"})
        )
        .unwrap(),
        json!([
            "--mount",
            format!("type=bind,src={source},dst=/package,readonly")
        ])
    );
}
