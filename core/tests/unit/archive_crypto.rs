use super::*;

#[test]
fn flushing_a_writer_does_not_finalize_or_split_the_authenticated_message() {
    let directory = tempfile::tempdir().unwrap();
    let encrypted = directory.path().join("archive.enc");
    let plaintext = directory.path().join("archive.tar");
    let context = OperationContext::default();
    let key = [7; 32];
    let mut writer = EncryptWriter::new(&encrypted, &key, &context).unwrap();
    writer.write_all(b"first partial block").unwrap();
    writer.flush().unwrap();
    writer.write_all(b" followed by more bytes").unwrap();
    let metadata = writer.finish().unwrap();
    let restored = decrypt(
        &encrypted,
        Some(&plaintext),
        &key,
        Some(&metadata.checksum_sha256),
        &serde_json::json!({}),
        &context,
    )
    .unwrap();
    assert_eq!(restored.archive_size, metadata.archive_size);
    assert_eq!(
        std::fs::read(plaintext).unwrap(),
        b"first partial block followed by more bytes"
    );
}
