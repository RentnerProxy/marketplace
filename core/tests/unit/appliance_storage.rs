use super::*;
use std::{
    cell::RefCell,
    os::unix::fs::{PermissionsExt, symlink},
};

fn fixture() -> (tempfile::TempDir, Paths, Environment, [(u32, u32); 4]) {
    let root = tempfile::tempdir().unwrap();
    let paths = Paths {
        data: root.path().join("data").to_str().unwrap().into(),
        runtime: root.path().join("run").to_str().unwrap().into(),
    };
    fs::create_dir(&paths.data).unwrap();
    let env = crate::appliance::create_environment(
        &[(
            "POSTGRES_PASSWORD".into(),
            "synthetic $ ; ä password".into(),
        )]
        .into_iter()
        .collect(),
        true,
    )
    .unwrap();
    let owner = unsafe { (libc::geteuid(), libc::getegid()) };
    (root, paths, env, [owner; 4])
}

#[test]
fn initializes_only_an_empty_cluster_with_exclusive_password_and_marker_files() {
    let (_root, paths, env, owners) = fixture();
    let called = RefCell::new(Vec::new());
    let runner = |program: &str,
                  arguments: &[&str],
                  child_env: &Environment,
                  _: Duration,
                  _: &AtomicBool| {
        called.borrow_mut().push(program.to_owned());
        assert_eq!(program, "su-exec");
        assert_eq!(arguments[0], "postgres:postgres");
        assert!(arguments.contains(&"--no-clean"));
        assert!(!child_env.contains_key("POSTGRES_PASSWORD"));
        assert_eq!(
            fs::read_to_string(format!("{}/initial-password", paths.socket())).unwrap(),
            format!("{}\n", env["POSTGRES_PASSWORD"])
        );
        assert_eq!(
            fs::metadata(format!("{}/initial-password", paths.socket()))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::write(format!("{}/PG_VERSION", paths.cluster()), "18\n").unwrap();
        Ok(Vec::new())
    };
    let cancelled = AtomicBool::new(false);
    prepare_with(&env, false, &cancelled, &paths, owners, &runner).unwrap();
    assert_eq!(called.borrow().as_slice(), ["su-exec"]);
    assert!(!Path::new(&format!("{}/initial-password", paths.socket())).exists());
    assert!(Path::new(&format!("{}/{MARKER}", paths.postgres())).exists());
    assert_eq!(
        fs::metadata(format!("{}/storage/private", paths.data))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    prepare_with(&env, false, &cancelled, &paths, owners, &runner).unwrap();
    assert_eq!(called.borrow().len(), 1);
    fs::remove_dir_all(format!("{}/storage", paths.data)).unwrap();
    prepare_with(&env, true, &cancelled, &paths, owners, &runner).unwrap();
    assert!(!Path::new(&format!("{}/storage", paths.data)).exists());
}

#[test]
fn rejects_foreign_nonempty_missing_and_symlinked_clusters_without_replacing_data() {
    for case in [
        "missing",
        "nonempty",
        "foreign",
        "symlink-version",
        "symlink-directory",
        "invalid-marker",
    ] {
        let (_root, paths, env, owners) = fixture();
        let cancelled = AtomicBool::new(false);
        fs::create_dir_all(paths.cluster()).unwrap();
        match case {
            "nonempty" => {
                fs::write(format!("{}/precious", paths.cluster()), "preserve").unwrap();
            }
            "foreign" => {
                fs::write(format!("{}/PG_VERSION", paths.cluster()), "17").unwrap();
            }
            "symlink-version" => {
                fs::write(format!("{}/version", paths.data), "18").unwrap();
                symlink(
                    format!("{}/version", paths.data),
                    format!("{}/PG_VERSION", paths.cluster()),
                )
                .unwrap();
            }
            "symlink-directory" => {
                fs::remove_dir(paths.cluster()).unwrap();
                symlink(&paths.data, paths.cluster()).unwrap();
            }
            "invalid-marker" => {
                symlink(&paths.data, format!("{}/{MARKER}", paths.postgres())).unwrap();
            }
            _ => (),
        }
        let runner = |_: &str,
                      _: &[&str],
                      _: &Environment,
                      _: Duration,
                      _: &AtomicBool|
         -> Result<Vec<u8>> {
            panic!("Invalid existing state must never initialize");
        };
        assert!(
            prepare_with(&env, case == "missing", &cancelled, &paths, owners, &runner).is_err(),
            "{case}"
        );
        if case == "nonempty" {
            assert_eq!(
                fs::read_to_string(format!("{}/precious", paths.cluster())).unwrap(),
                "preserve"
            );
        }
    }
}

#[test]
fn failed_or_cancelled_initialization_preserves_marker_and_cleans_password() {
    for cancel in [false, true] {
        let (_root, paths, env, owners) = fixture();
        let runner = |_: &str,
                      _: &[&str],
                      _: &Environment,
                      _: Duration,
                      _: &AtomicBool|
         -> Result<Vec<u8>> { Err("synthetic_command_failed") };
        assert!(
            prepare_with(
                &env,
                false,
                &AtomicBool::new(cancel),
                &paths,
                owners,
                &runner
            )
            .is_err()
        );
        assert!(Path::new(&format!("{}/{MARKER}", paths.postgres())).exists());
        assert!(!Path::new(&format!("{}/initial-password", paths.socket())).exists());
    }
}

#[test]
fn database_creation_is_marker_gated_and_preserves_retry_on_command_failure() {
    for state in ["absent", "existing", "new", "failed", "invalid"] {
        let (_root, paths, env, _owners) = fixture();
        fs::create_dir_all(paths.postgres()).unwrap();
        let marker = format!("{}/{MARKER}", paths.postgres());
        if state == "invalid" {
            symlink(&paths.data, &marker).unwrap();
        } else if state != "absent" {
            fs::write(&marker, "").unwrap();
        }
        let calls = RefCell::new(Vec::new());
        let runner = |program: &str,
                      arguments: &[&str],
                      child_env: &Environment,
                      _: Duration,
                      _: &AtomicBool|
         -> Result<Vec<u8>> {
            calls.borrow_mut().push(program.to_owned());
            assert!(
                !arguments
                    .iter()
                    .any(|argument| argument.contains(&env["POSTGRES_PASSWORD"]))
            );
            assert_eq!(child_env["PGPASSWORD"], env["POSTGRES_PASSWORD"]);
            if state == "failed" || program == "psql" && state == "new" {
                Err("synthetic_command_failed")
            } else {
                Ok(b"1".to_vec())
            }
        };
        let result = initialize_database_with(&env, &AtomicBool::new(false), &paths, &runner);
        assert_eq!(result.is_err(), matches!(state, "failed" | "invalid"));
        assert_eq!(
            Path::new(&marker).exists(),
            matches!(state, "failed" | "invalid")
        );
        if state == "new" {
            assert_eq!(calls.borrow().as_slice(), ["psql", "createdb"]);
        }
        if state == "existing" {
            assert_eq!(calls.borrow().as_slice(), ["psql"]);
        }
        if matches!(state, "invalid" | "absent") {
            assert!(calls.borrow().is_empty());
        }
    }
}

#[test]
fn identity_and_private_file_boundaries_fail_closed() {
    let cancelled = AtomicBool::new(false);
    assert!(identity("root", &cancelled).is_ok());
    assert!(identity("tanstack-fixture-nonexistent", &cancelled).is_err());
    let (root, paths, _env, _owners) = fixture();
    assert!(directory(Path::new("relative"), false).is_err());
    fs::write(root.path().join("file"), "data").unwrap();
    assert!(directory(&root.path().join("file"), false).is_err());
    fs::create_dir(format!("{}/directory", paths.data)).unwrap();
    assert!(private_file(&paths.data, "directory", false).is_err());
    private_file(&paths.data, "private", true).unwrap();
    assert!(private_file(&paths.data, "private", true).is_err());
    assert!(private_file(&paths.data, "private", false).is_ok());
}
