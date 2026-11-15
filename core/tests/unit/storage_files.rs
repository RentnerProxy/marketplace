use super::*;

#[test]
fn directory_walk_opens_existing_and_creates_only_missing_components() {
    let directory = tempfile::tempdir().unwrap();
    let root = Dir::open_ambient_dir(directory.path(), ambient_authority()).unwrap();
    root.create_dir("existing").unwrap();
    let before = root
        .open_dir_nofollow("existing")
        .unwrap()
        .dir_metadata()
        .unwrap();

    for create in [false, true] {
        let opened = open_absolute(&directory.path().join("existing"), create).unwrap();
        assert!(same(&before, &opened.dir_metadata().unwrap()));
        let opened = descend(&root, Path::new("existing"), create, false).unwrap();
        assert!(same(&before, &opened.dir_metadata().unwrap()));
    }

    for (path, absolute_walk) in [("absolute/child", true), ("relative/child", false)] {
        let missing = if absolute_walk {
            open_absolute(&directory.path().join(path), false)
        } else {
            descend(&root, Path::new(path), false, false)
        };
        assert_eq!(missing.unwrap_err().code, "ENOENT");
        assert!(
            !directory
                .path()
                .join(path.split('/').next().unwrap())
                .exists()
        );

        let opened = if absolute_walk {
            open_absolute(&directory.path().join(path), true)
        } else {
            descend(&root, Path::new(path), true, true)
        }
        .unwrap();
        let actual = root.open_dir_nofollow(path).unwrap();
        assert!(same(
            &opened.dir_metadata().unwrap(),
            &actual.dir_metadata().unwrap()
        ));
    }
}

#[test]
fn directory_walk_rejects_files_without_replacing_them() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("file");
    std::fs::write(&path, b"unchanged").unwrap();
    let root = Dir::open_ambient_dir(directory.path(), ambient_authority()).unwrap();
    for create in [false, true] {
        assert!(open_absolute(&path, create).is_err());
        assert!(descend(&root, Path::new("file"), create, true).is_err());
        assert!(open_absolute(&path.join("child"), create).is_err());
        assert!(descend(&root, Path::new("file/child"), create, true).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"unchanged");
    }
}

#[cfg(unix)]
#[test]
fn directory_walk_rejects_directory_and_dangling_symlinks() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let root = Dir::open_ambient_dir(directory.path(), ambient_authority()).unwrap();
    symlink(outside.path(), directory.path().join("link")).unwrap();
    symlink(
        outside.path().join("missing"),
        directory.path().join("dangling"),
    )
    .unwrap();

    for name in ["link", "dangling"] {
        for create in [false, true] {
            assert!(open_absolute(&directory.path().join(name), create).is_err());
            assert!(descend(&root, Path::new(name), create, true).is_err());
            assert!(open_absolute(&directory.path().join(name).join("child"), create).is_err());
            assert!(descend(&root, &Path::new(name).join("child"), create, true).is_err());
            assert!(
                std::fs::symlink_metadata(directory.path().join(name))
                    .unwrap()
                    .is_symlink()
            );
        }
    }
    assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
}

#[cfg(unix)]
#[test]
fn secure_descent_repairs_existing_directory_modes_on_every_walk() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let directory = tempfile::tempdir().unwrap();
    let root = Dir::open_ambient_dir(directory.path(), ambient_authority()).unwrap();
    std::fs::create_dir_all(directory.path().join("parent/child")).unwrap();
    for create in [false, true] {
        for name in ["parent", "parent/child"] {
            std::fs::set_permissions(
                directory.path().join(name),
                std::fs::Permissions::from_mode(0o777),
            )
            .unwrap();
        }
        descend(&root, Path::new("parent/child"), create, true).unwrap();
        for name in ["parent", "parent/child"] {
            assert_eq!(
                std::fs::metadata(directory.path().join(name))
                    .unwrap()
                    .mode()
                    & 0o7777,
                0o700
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn directory_walk_propagates_permission_errors_when_permissions_are_enforced() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().unwrap();
    let root = Dir::open_ambient_dir(directory.path(), ambient_authority()).unwrap();
    let blocked = directory.path().join("blocked");
    std::fs::create_dir_all(blocked.join("child")).unwrap();
    let blocked_dir = root.open_dir_nofollow("blocked").unwrap();
    std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o000)).unwrap();
    // Root and capability-bearing test users may bypass mode bits. Probe the
    // actual filesystem rather than assuming the runner's privilege level.
    let enforced = blocked_dir.open_dir_nofollow("child").is_err();
    let absolute_result = open_absolute(&blocked.join("child"), true);
    let relative_result = descend(&root, Path::new("blocked/child"), true, false);
    std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o700)).unwrap();
    if enforced {
        assert_eq!(absolute_result.unwrap_err().code, "EACCES");
        assert_eq!(relative_result.unwrap_err().code, "EACCES");
    }
}

#[test]
fn lexical_scope_rejects_parent_components_even_without_normalization() {
    let root = absolute("synthetic-root").unwrap();
    assert!(relative(&root, &root.join("../outside"), false).is_err());
    assert!(relative(&root, &root, false).is_err());
    assert_eq!(
        relative(&root, &root.join("nested/file"), false).unwrap(),
        Path::new("nested/file")
    );
    assert!(
        absolute("nested/../synthetic-root")
            .unwrap()
            .ends_with("synthetic-root")
    );
}

#[test]
fn private_publication_replaces_root_and_nested_targets_without_leaving_stages() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("private");
    for relative in ["payload.bin", "nested/payload.bin"] {
        let destination = root.join(relative);
        for payload in [b"original".as_slice(), b"replacement".as_slice()] {
            write(
                &json!({
                    "rootDirectory": root,
                    "filePath": destination,
                    "dataBase64": STANDARD.encode(payload),
                }),
                &OperationContext::cleanup(),
            )
            .unwrap();
            assert_eq!(std::fs::read(&destination).unwrap(), payload);
        }
        assert!(
            std::fs::read_dir(destination.parent().unwrap())
                .unwrap()
                .all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".private-file-"))
        );
    }
}
