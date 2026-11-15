use base64::{Engine, engine::general_purpose::STANDARD};
use marketplace_core::{
    protocol::OperationContext,
    storage::{execute, execute_worker},
};
use serde_json::{Value, json};
use std::{fs, path::Path};

fn payloads() -> [Vec<u8>; 3] {
    [
        b"RIFF\x04\0\0\0WEBP".to_vec(),
        b"RIFF\x04\0\0\0WEBP".to_vec(),
        vec![
            0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0, 8, 0, 0, 0, 22, 0, 0, 0, 137, 80, 78, 71,
            13, 10, 26, 10,
        ],
    ]
}

fn request(root: &Path) -> Value {
    json!({"operation":"brandingPublish","rootDirectory":root,"binaryLengths":[12,12,30]})
}

#[test]
fn binary_branding_matches_legacy_files_and_preserves_input() {
    let temp = tempfile::tempdir().unwrap();
    let binary_root = temp.path().join("binary");
    let legacy_root = temp.path().join("legacy");
    let inputs = payloads();
    let bytes = inputs.concat();
    let original = bytes.clone();
    execute_worker(
        &request(&binary_root),
        Some(&bytes),
        &OperationContext::cleanup(),
    )
    .unwrap();
    execute(
        json!({"operation":"brandingPublish","rootDirectory":legacy_root,
        "largeBase64":STANDARD.encode(&inputs[0]),"smallBase64":STANDARD.encode(&inputs[1]),
        "faviconBase64":STANDARD.encode(&inputs[2])}),
        &OperationContext::cleanup(),
    )
    .unwrap();
    assert_eq!(bytes, original);
    for (index, name) in [
        "images/system/logo.webp",
        "images/system/logo-64.webp",
        "favicon.ico",
    ]
    .iter()
    .enumerate()
    {
        assert_eq!(fs::read(binary_root.join(name)).unwrap(), inputs[index]);
        assert_eq!(
            fs::read(binary_root.join(name)).unwrap(),
            fs::read(legacy_root.join(name)).unwrap()
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(binary_root.join(name))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o7777,
                0o600
            );
        }
    }
    assert!(fs::read_dir(binary_root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".branding-")
    }));
}

#[test]
fn malformed_binary_lengths_and_mixed_encodings_never_create_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("uncreated");
    let bytes = payloads().concat();
    for lengths in [
        json!(null),
        json!([]),
        json!([12, 12]),
        json!([12, 12, 30, 1]),
        json!([0, 12, 42]),
        json!([-1, 12, 43]),
        json!([12.5, 12, 29.5]),
        json!([8388609, 12, 30]),
        json!([12, 12, 31]),
        json!([12, "12", 30]),
    ] {
        let mut input = request(&root);
        input["binaryLengths"] = lengths;
        assert!(execute_worker(&input, Some(&bytes), &OperationContext::cleanup()).is_err());
        assert!(!root.exists());
    }
    for field in ["largeBase64", "smallBase64", "faviconBase64"] {
        let mut input = request(&root);
        input[field] = Value::Null;
        assert!(execute_worker(&input, Some(&bytes), &OperationContext::cleanup()).is_err());
        assert!(!root.exists());
    }
    assert!(execute_worker(&request(&root), None, &OperationContext::cleanup()).is_err());
    assert!(!root.exists());
}

#[test]
fn malformed_signatures_and_truncated_or_extra_bytes_never_mutate() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("uncreated");
    for offset in [0, 4, 8, 12, 16, 20, 24, 38, 42, 46] {
        let mut bytes = payloads().concat();
        bytes[offset] ^= 255;
        let original = bytes.clone();
        assert!(
            execute_worker(&request(&root), Some(&bytes), &OperationContext::cleanup()).is_err()
        );
        assert_eq!(bytes, original);
        assert!(!root.exists());
    }
    let bytes = payloads().concat();
    for candidate in [&bytes[..53], &[bytes.as_slice(), &[0]].concat()] {
        assert!(
            execute_worker(
                &request(&root),
                Some(candidate),
                &OperationContext::cleanup()
            )
            .is_err()
        );
        assert!(!root.exists());
    }
}

#[test]
fn cancellation_preserves_existing_branding() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("public");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("favicon.ico"), b"original").unwrap();
    let context = OperationContext::cleanup();
    context.cancel();
    assert_eq!(
        execute_worker(&request(&root), Some(&payloads().concat()), &context)
            .err()
            .unwrap()
            .code,
        "CORE_CANCELLED"
    );
    assert_eq!(fs::read(root.join("favicon.ico")).unwrap(), b"original");
    assert_eq!(fs::read_dir(root).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn binary_branding_rejects_symlink_destination_and_preserves_outside() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("public");
    let outside = temp.path().join("outside");
    fs::create_dir(&root).unwrap();
    fs::write(&outside, b"outside").unwrap();
    symlink(&outside, root.join("favicon.ico")).unwrap();
    assert!(
        execute_worker(
            &request(&root),
            Some(&payloads().concat()),
            &OperationContext::cleanup()
        )
        .is_err()
    );
    assert_eq!(fs::read(outside).unwrap(), b"outside");
    assert!(!root.join("images/system/logo.webp").exists());
    assert!(fs::read_dir(root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".branding-")
    }));
}
