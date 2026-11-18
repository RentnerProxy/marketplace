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

#[cfg(unix)]
#[test]
fn docker_fixture_exercises_native_limits_staging_and_cleanup() {
    use serde_json::Value;
    use std::env;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::process::{Command, Output, Stdio};

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let docker = path.join("docker");
    fs::write(
        &docker,
        r#"#!/bin/sh
case "$1" in
    version) printf 'linux/amd64\n' ;;
    create) printf '%s\n' "$@" > "${0%/*}/create-args" ;;
    start)
        if [ "$2" = '--attach' ]; then
            case "$(/bin/cat "${0%/*}/mode")" in
                ok) printf 'archive bytes' ;;
                extra) printf 'longer than four bytes' ;;
                failed) printf 'partial'; exit 9 ;;
                slow) exec /bin/sleep 5 ;;
            esac
        fi
        ;;
    exec)
        if [ "$2" = '--interactive' ]; then
            IFS= read -r value
            [ "$value" = 'bootstrap fixture' ] || exit 10
        else
            printf 'ELF fixture'
        fi
        ;;
    rm) printf 'No such container\n' >&2; exit 1 ;;
    *) exit 11 ;;
esac
"#,
    )
    .unwrap();
    fs::set_permissions(&docker, fs::Permissions::from_mode(0o700)).unwrap();
    let path_env = env::join_paths(
        std::iter::once(path.to_path_buf()).chain(env::split_paths(&env::var_os("PATH").unwrap())),
    )
    .unwrap();
    let invoke = |operation: &str, input: Value| -> Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_marketplace-app-pipeline"))
            .arg(format!("sandbox-{operation}"))
            .env("PATH", &path_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        serde_json::to_writer(child.stdin.take().unwrap(), &input).unwrap();
        child.wait_with_output().unwrap()
    };
    let name = "marketplace-candidate-11111111-1111-4111-8111-111111111111";
    let mut create = json!({
        "name": name,
        "config": {
            "target": "linux-amd64",
            "image": format!("ghcr.io/rentnerproxy/platform@sha256:{}", "a".repeat(64)),
            "memoryMiB": 128,
            "processLimit": 32,
            "mounts": [],
            "command": ["/usr/bin/true"],
        },
    });
    assert!(invoke("create", create.clone()).status.success());
    let args = fs::read_to_string(path.join("create-args")).unwrap();
    for flags in [
        "--network\nnone",
        "--read-only",
        "--cap-drop\nALL",
        "--pids-limit\n32",
        "--memory\n128m",
    ] {
        assert!(args.contains(flags), "{flags}");
    }
    create["config"]["target"] = json!("linux-arm64");
    assert!(!invoke("create", create).status.success());
    for args in [
        json!(["start", name]),
        json!(["rm", "--force", "--volumes", name]),
    ] {
        assert!(invoke("docker", json!({"args": args})).status.success());
    }
    assert!(
        invoke(
            "attach",
            json!({
                "args": ["exec", "--interactive", "--user", "21002:21004", name, "/usr/bin/env", "-i"],
                "operation": "Bounded fixture",
                "timeout": 2_000,
                "input": "bootstrap fixture\n",
            })
        )
        .status
        .success()
    );

    let archive = path.join("package.tar");
    for (mode, maximum, timeout, error) in [
        ("extra", 4, 2_000, "exceeded its byte limit"),
        ("failed", 100, 2_000, "failed with exit status 9"),
        ("slow", 100, 60, "exceeded its limits"),
        ("ok", 100, 2_000, ""),
    ] {
        fs::write(path.join("mode"), mode).unwrap();
        let output = invoke(
            "attach",
            json!({
                "args": ["start", "--attach", name],
                "operation": "Bounded archive fixture",
                "timeout": timeout,
                "archive": {"path": archive, "maxBytes": maximum},
            }),
        );
        assert_eq!(output.status.success(), error.is_empty(), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stderr).contains(error));
        assert_eq!(archive.exists(), error.is_empty());
    }
    assert_eq!(fs::read(archive).unwrap(), b"archive bytes");
}
