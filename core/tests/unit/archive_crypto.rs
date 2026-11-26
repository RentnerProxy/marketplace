use super::*;

#[test]
fn flushing_a_writer_does_not_finalize_or_split_the_authenticated_message() {
    let directory = tempfile::tempdir().unwrap();
    let encrypted = directory.path().join("archive.enc");
    let plaintext = directory.path().join("archive.tar");
    let context = OperationContext::cleanup();
    let key = [7; 32];
    let mut writer = EncryptWriter::new(&encrypted, &key, &context).unwrap();
    writer.write_all(b"first partial block").unwrap();
    writer.flush().unwrap();
    writer.write_all(b" followed by more bytes").unwrap();
    let metadata = writer.finish().unwrap();
    let request = json!({"expectedChecksumSha256":metadata.checksum_sha256});
    let restored = DecryptReader::new(&encrypted, &key, &request, &context)
        .unwrap()
        .write_temporary(&plaintext)
        .unwrap();
    assert_eq!(restored.archive_size, metadata.archive_size);
    assert_eq!(
        std::fs::read(plaintext).unwrap(),
        b"first partial block followed by more bytes"
    );
}

#[test]
fn readers_authenticate_empty_partial_and_multichunk_envelopes() {
    let directory = tempfile::tempdir().unwrap();
    let context = OperationContext::cleanup();
    let key = [7; 32];
    for length in [0, 1, 15, 16, 17, CHUNK - 1, CHUNK, CHUNK + 1, 200003] {
        let encrypted = directory.path().join(format!("envelope-{length}"));
        let bytes: Vec<_> = (0..length).map(|index| (index % 251) as u8).collect();
        let mut writer = EncryptWriter::new(&encrypted, &key, &context).unwrap();
        writer.write_all(&bytes).unwrap();
        let expected = writer.finish().unwrap();
        let request = json!({"expectedChecksumSha256":expected.checksum_sha256});
        let mut reader = DecryptReader::new(&encrypted, &key, &request, &context).unwrap();
        assert_eq!(reader.read(&mut []).unwrap(), 0);
        let mut actual = vec![0; length];
        for piece in actual.chunks_mut(523) {
            reader.read_exact(piece).unwrap();
        }
        assert_eq!(reader.read(&mut [0]).unwrap(), 0);
        let metadata = reader.finish().unwrap();
        assert_eq!(actual, bytes);
        assert_eq!(metadata.plaintext_size, length as u64);
        assert_eq!(metadata.archive_size, length as u64 + ENVELOPE_OVERHEAD);
        assert_eq!(metadata.checksum_sha256, expected.checksum_sha256);
    }
}

#[test]
fn reader_preserves_typed_cancellation_after_a_partial_parse() {
    let directory = tempfile::tempdir().unwrap();
    let encrypted = directory.path().join("envelope");
    let context = OperationContext::cleanup();
    let key = [7; 32];
    let mut writer = EncryptWriter::new(&encrypted, &key, &context).unwrap();
    writer.write_all(&vec![1; CHUNK + 1]).unwrap();
    writer.finish().unwrap();
    let request = json!({});
    let mut reader = DecryptReader::new(&encrypted, &key, &request, &context).unwrap();
    reader.read_exact(&mut vec![0; CHUNK]).unwrap();
    context.cancel();
    assert!(reader.read(&mut [0]).is_err());
    assert_eq!(reader.finish().err().unwrap().code, "CORE_CANCELLED");
}
