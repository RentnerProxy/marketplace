use super::*;
use std::{
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt, symlink},
};

const NOW: f64 = 60_000.0;

fn heartbeat(timestamp: i64) -> String {
    format!(r#"{{"version":1,"status":"healthy","updatedAt":{timestamp},"pid":42}}"#)
}

#[test]
fn heartbeat_accepts_only_current_healthy_records_with_the_producer_schema() {
    for (timestamp, healthy) in [
        (29_999, false),
        (30_000, true),
        (60_000, true),
        (65_000, true),
        (65_001, false),
        (-1, false),
    ] {
        assert_eq!(is_current(heartbeat(timestamp).as_bytes(), NOW), healthy);
    }
    assert!(is_current(
        br#"{"version":1.0,"status":"healthy","updatedAt":6e4,"pid":42.0}"#,
        NOW
    ));
    for invalid in [
        r#"{"version":2,"status":"healthy","updatedAt":60000,"pid":42}"#,
        r#"{"version":1,"status":"unhealthy","updatedAt":60000,"pid":42}"#,
        r#"{"version":1,"status":"starting","updatedAt":60000,"pid":42}"#,
        r#"{"version":1,"status":"healthy","updatedAt":60000.5,"pid":42}"#,
        r#"{"version":1,"status":"healthy","updatedAt":"60000","pid":42}"#,
        r#"{"version":1,"status":"healthy","updatedAt":60000,"pid":0}"#,
        r#"{"version":1,"status":"healthy","updatedAt":60000,"pid":9007199254740992}"#,
        r#"{"version":1,"status":"healthy","updatedAt":60000}"#,
        r#"{"version":1,"status":"healthy","updatedAt":60000,"pid":42,"other":true}"#,
        r#"{"version":"1","status":"healthy","updatedAt":60000,"pid":42}"#,
        "malformed",
    ] {
        assert!(!is_current(invalid.as_bytes(), NOW), "{invalid}");
    }
}

#[test]
fn heartbeat_requires_a_bounded_private_regular_file_with_the_worker_owner() {
    let dir = tempfile::tempdir().unwrap();
    let uid = dir.path().metadata().unwrap().uid();
    let root = dir.path().to_str().unwrap();
    let path = dir.path().join(FILENAME);
    assert!(!check(root, uid, NOW));

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .unwrap();
    file.write_all(heartbeat(60_000).as_bytes()).unwrap();
    assert!(check(root, uid, NOW));
    assert!(!check(root, uid.wrapping_add(1), NOW));

    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(!check(root, uid, NOW));
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let link = dir.path().join("other.json");
    fs::hard_link(&path, &link).unwrap();
    assert!(!check(root, uid, NOW));
    fs::remove_file(&link).unwrap();

    file.set_len(MAX_BYTES + 1).unwrap();
    assert!(!check(root, uid, NOW));
    fs::write(&path, heartbeat(60_000)).unwrap();
    fs::rename(&path, &link).unwrap();
    symlink(&link, &path).unwrap();
    assert!(!check(root, uid, NOW));

    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(!check(root, uid, NOW));
}
