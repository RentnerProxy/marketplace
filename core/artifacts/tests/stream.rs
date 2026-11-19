use marketplace_artifacts::{FileIdentity, StreamVerification, digest, verify_stream};
use std::fs;

#[test]
fn verified_bytes_only_publish_to_a_fresh_destination() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("artifact");
    let bytes = b"verified artifact";
    let expected = FileIdentity {
        sha256: digest(bytes),
        size_bytes: bytes.len() as u64,
    };
    assert_eq!(
        verify_stream(&bytes[..4], &expected, Some(&path)).unwrap(),
        StreamVerification::Mismatch
    );
    assert!(!path.exists());
    assert_eq!(
        verify_stream(&bytes[..], &expected, Some(&path)).unwrap(),
        StreamVerification::Verified
    );
    assert!(verify_stream(&bytes[..], &expected, Some(&path)).is_err());
    assert_eq!(fs::read(path).unwrap(), bytes);
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}
