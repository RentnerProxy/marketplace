use base64::Engine;
use marketplace_core::{archive, protocol::OperationContext};
use serde_json::{Value, json};
use std::fs;

fn key() -> String {
    base64::engine::general_purpose::STANDARD.encode([7; 32])
}
fn call(mut request: Value) -> Result<Value, marketplace_core::protocol::CoreError> {
    request["key"] = json!(key());
    archive::execute(request, &OperationContext::default())
}
fn fixture(root: &std::path::Path, storage: bool) -> std::path::PathBuf {
    let database = root.join("database.dump");
    fs::write(&database, b"PGDMP\0binary database content").unwrap();
    let archive = root.join("backup.enc");
    let storage_root = root.join("source");
    fs::create_dir(&storage_root).unwrap();
    fs::create_dir(storage_root.join("Bilder")).unwrap();
    fs::write(storage_root.join("Bilder/Ölbild.txt"), b"private image").unwrap();
    let manifest = if storage {
        json!({"version":3,"createdAt":"2026-11-10T09:00:00.000Z","appVersion":"test","includesStorage":true,"privateBackgroundsVersion":1})
    } else {
        json!({"version":3,"createdAt":"2026-11-10T09:00:00.000Z","appVersion":"test","includesStorage":false})
    };
    call(json!({"operation":"create","databaseDumpPath":database,"destinationPath":archive,"storageRoot":storage_root,"manifest":manifest,"mtime":1700000000})).unwrap();
    archive
}
#[test]
fn archive_roundtrip_authenticates_and_extracts_unicode_pax() {
    let temp = tempfile::tempdir().unwrap();
    let archive = fixture(temp.path(), true);
    let validated =
        call(json!({"operation":"validate","sourcePath":archive,"temporaryDirectory":temp.path()}))
            .unwrap();
    assert_eq!(validated["manifest"]["privateBackgroundsVersion"], 1);
    let output = temp.path().join("output");
    fs::create_dir(&output).unwrap();
    let extracted=call(json!({"operation":"extract","sourcePath":archive,"temporaryDirectory":temp.path(),"destinationDirectory":output,"expectedChecksumSha256":validated["checksumSha256"]})).unwrap();
    assert_eq!(extracted, validated);
    assert_eq!(
        fs::read(output.join("storage/Bilder/Ölbild.txt")).unwrap(),
        b"private image"
    );
    assert_eq!(
        fs::read(output.join("database.dump")).unwrap(),
        b"PGDMP\0binary database content"
    );
    assert!(!output.join("manifest.json").exists());
    assert!(!output.join("integrity.json").exists());
    assert!(fs::read_dir(temp.path()).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("decrypted-")
    }));
}
#[test]
fn tampering_wrong_key_and_checksums_fail_without_retaining_plaintext() {
    let temp = tempfile::tempdir().unwrap();
    let archive = fixture(temp.path(), false);
    let original = fs::read(&archive).unwrap();
    for index in [0, 8, 9, 10, 42, 54, original.len() - 1] {
        let mut bytes = original.clone();
        bytes[index] ^= 1;
        fs::write(&archive, &bytes).unwrap();
        assert!(call(json!({"operation":"validate","sourcePath":archive,"temporaryDirectory":temp.path()})).is_err());
        assert!(fs::read_dir(temp.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("decrypted-")
        }));
    }
    fs::write(&archive, &original).unwrap();
    assert!(call(json!({"operation":"authenticate","sourcePath":archive,"expectedChecksumSha256":"0".repeat(64)})).is_err());
    let wrong = archive::execute(
        json!({"operation":"authenticate","sourcePath":archive,"key":base64::engine::general_purpose::STANDARD.encode([8;32])}),
        &OperationContext::default(),
    );
    assert!(wrong.is_err());
}
#[test]
fn portable_paths_reject_traversal_windows_devices_and_ambiguous_segments() {
    for path in [
        "../database.dump",
        "/storage/file",
        "storage/../file",
        "storage/./file",
        "storage//file",
        "storage/CON.txt",
        "storage/com¹.txt",
        "storage/LPT9",
        "storage/file.",
        "storage/file ",
        "storage/a:b",
        "storage/a\\b",
        "storage/\u{fffd}",
        "storage/a\0b",
        "storage/a?b",
        "unexpected",
    ] {
        assert!(
            call(json!({"operation":"validateEntry","path":path,"size":0,"kind":"file"})).is_err(),
            "accepted {path:?}"
        );
    }
    let normalized=call(json!({"operation":"validateEntry","path":"storage/O\u{308}lbild.txt","size":0,"kind":"file"})).unwrap();
    assert_eq!(normalized["path"], "storage/Ölbild.txt");
    assert!(
        call(json!({"operation":"validateEntry","path":"storage","size":1,"kind":"directory"}))
            .is_err()
    );
}
fn plaintext(root: &std::path::Path, archive: &std::path::Path) -> Vec<u8> {
    let path = root.join("plain.tar");
    call(json!({"operation":"decrypt","sourcePath":archive,"destinationPath":path})).unwrap();
    let bytes = fs::read(&path).unwrap();
    fs::remove_file(path).unwrap();
    bytes
}
fn check_tar(root: &std::path::Path, bytes: &[u8]) -> bool {
    let path = root.join("mutated.tar");
    fs::write(&path, bytes).unwrap();
    call(json!({"operation":"processTar","sourcePath":path})).is_ok()
}
fn checksum(header: &mut [u8]) {
    header[148..156].fill(b' ');
    let total: u64 = header.iter().map(|b| *b as u64).sum();
    header[148..156].copy_from_slice(format!("{total:06o}\0 ").as_bytes());
}
#[test]
fn strict_physical_tar_rejects_unsafe_types_padding_headers_and_trailing_data() {
    let temp = tempfile::tempdir().unwrap();
    let archive = fixture(temp.path(), false);
    let bytes = plaintext(temp.path(), &archive);
    assert!(check_tar(temp.path(), &bytes));
    let mut corrupt = bytes.clone();
    corrupt[0] ^= 1;
    assert!(!check_tar(temp.path(), &corrupt));
    for kind in *b"123467gLK" {
        let mut corrupt = bytes.clone();
        corrupt[156] = kind;
        checksum(&mut corrupt[..512]);
        assert!(!check_tar(temp.path(), &corrupt), "accepted type {kind}");
    }
    let mut corrupt = bytes.clone();
    corrupt[257] = b'X';
    checksum(&mut corrupt[..512]);
    assert!(!check_tar(temp.path(), &corrupt));
    let mut corrupt = bytes.clone();
    corrupt[157] = b'x';
    checksum(&mut corrupt[..512]);
    assert!(!check_tar(temp.path(), &corrupt));
    let size =
        u64::from_str_radix(std::str::from_utf8(&bytes[124..135]).unwrap(), 8).unwrap() as usize;
    let mut corrupt = bytes.clone();
    corrupt[512 + size] = 1;
    assert!(!check_tar(temp.path(), &corrupt));
    let mut corrupt = bytes.clone();
    corrupt.extend_from_slice(b"unexpected");
    assert!(!check_tar(temp.path(), &corrupt));
    assert!(!check_tar(temp.path(), &bytes[..bytes.len() - 512]));
}
#[test]
fn extraction_never_overwrites_existing_files_or_follows_directory_links() {
    let temp = tempfile::tempdir().unwrap();
    let archive = fixture(temp.path(), true);
    let output = temp.path().join("output");
    fs::create_dir(&output).unwrap();
    fs::write(output.join("database.dump"), b"existing").unwrap();
    assert!(call(json!({"operation":"extract","sourcePath":archive,"temporaryDirectory":temp.path(),"destinationDirectory":output})).is_err());
    assert_eq!(fs::read(output.join("database.dump")).unwrap(), b"existing");
    #[cfg(unix)]
    {
        let output = temp.path().join("symlink-output");
        fs::create_dir(&output).unwrap();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, output.join("storage")).unwrap();
        assert!(call(json!({"operation":"extract","sourcePath":archive,"temporaryDirectory":temp.path(),"destinationDirectory":output})).is_err());
        assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
    }
}
#[test]
fn source_identity_budget_cancellation_and_admission_are_enforced() {
    let temp = tempfile::tempdir().unwrap();
    let archive = fixture(temp.path(), false);
    assert!(call(json!({"operation":"authenticate","sourcePath":archive,"expectedSourceIdentity":{"dev":"0","ino":"0","size":"0","mtimeNs":"0","ctimeNs":"0"}})).is_err());
    let output = temp.path().join("copy.enc");
    assert!(call(json!({"operation":"copy","sourcePath":archive,"destinationPath":output,"maximumWriteBytes":1})).is_err());
    assert!(!output.exists());
    let context = OperationContext::default();
    context.cancel();
    assert!(
        archive::execute(
            json!({"operation":"authenticate","sourcePath":archive,"key":key()}),
            &context
        )
        .is_err()
    );
    let directory = temp.path().join("admission");
    let admission = call(
        json!({"operation":"admissionAcquire","directory":directory,"maximumUploadBytes":1024}),
    )
    .unwrap();
    assert!(
        call(
            json!({"operation":"admissionAcquire","directory":directory,"maximumUploadBytes":1024})
        )
        .is_err()
    );
    assert!(call(json!({"operation":"admissionReserve","directory":directory,"token":"wrong","byteLength":1})).is_err());
    assert!(call(json!({"operation":"admissionReserve","directory":directory,"token":admission["token"],"byteLength":3072})).is_err());
    call(json!({"operation":"admissionMarkIncomplete","directory":directory,"token":admission["token"]})).unwrap();
    assert!(
        call(
            json!({"operation":"admissionRelease","directory":directory,"token":admission["token"]})
        )
        .is_err()
    );
    assert!(directory.exists());
}

#[test]
fn reads_fixed_independent_node_tar_stream_and_crypto_archives() {
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/node-archives.json")).unwrap();
    for fixture in fixtures {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("node.enc");
        fs::write(
            &source,
            base64::engine::general_purpose::STANDARD
                .decode(fixture["envelopeBase64"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        let actual = call(
            json!({"operation":"validate","sourcePath":source,"temporaryDirectory":temp.path()}),
        )
        .unwrap();
        assert_eq!(actual["manifest"], fixture["manifest"]);
        assert_eq!(actual["checksumSha256"], fixture["checksumSha256"]);
        assert_eq!(actual["archiveSize"], fixture["archiveSize"]);
        let authenticated = call(json!({"operation":"authenticate","sourcePath":source})).unwrap();
        assert_eq!(authenticated["plaintextSize"], fixture["plaintextSize"]);
    }
}

#[test]
fn private_backgrounds_override_public_files_and_create_missing_parents() {
    let temp = tempfile::tempdir().unwrap();
    let public = temp.path().join("public");
    let private = temp.path().join("private");
    fs::create_dir_all(public.join("users/alice")).unwrap();
    fs::create_dir_all(private.join("backgrounds/alice")).unwrap();
    fs::write(public.join("users/alice/background.avif"), b"old public").unwrap();
    fs::write(
        private.join("backgrounds/alice/background.avif"),
        b"new private",
    )
    .unwrap();
    let layout = json!({"publicRelativeDirectory":"users","privateRelativeDirectory":"backgrounds","fileName":"background.avif"});
    let entries=call(json!({"operation":"backgroundCollect","storageRoot":private,"location":"private","layout":layout})).unwrap();
    assert_eq!(entries.as_array().unwrap().len(), 1);
    let entry = &entries[0];
    assert_eq!(entry["size"], 11);
    assert!(entry["identity"]["ino"].is_string());
    let request = json!({"operation":"collect","storageRoot":public,"privateEntries":[{"path":"storage/users/alice/background.avif","type":"file","size":11,"absolutePath":entry["absolutePath"]},{"path":"storage/users/bob/background.avif","type":"file","size":11,"absolutePath":entry["absolutePath"]}]});
    let sources = call(request).unwrap();
    let sources = sources.as_array().unwrap();
    assert!(
        sources
            .iter()
            .any(|s| s["path"] == "storage/users/bob" && s["type"] == "directory")
    );
    assert!(
        sources
            .iter()
            .any(|s| s["path"] == "storage/users/alice/background.avif"
                && s["absolutePath"] == entry["absolutePath"])
    );
    let restored = temp.path().join("restore");
    fs::create_dir_all(restored.join("storage/users/alice")).unwrap();
    fs::write(
        restored.join("storage/users/alice/background.avif"),
        b"restored",
    )
    .unwrap();
    let partition = call(
        json!({"operation":"backgroundPartition","restoreDirectory":restored,"layout":layout}),
    )
    .unwrap();
    assert_eq!(partition["relativeFilePaths"].as_array().unwrap().len(), 1);
    assert_eq!(
        fs::read(restored.join("private-backgrounds/backgrounds/alice/background.avif")).unwrap(),
        b"restored"
    );
    assert!(
        !restored
            .join("storage/users/alice/background.avif")
            .exists()
    );
}

#[test]
fn background_root_layout_and_collection_reject_overlaps_and_unsafe_files() {
    let temp = tempfile::tempdir().unwrap();
    let public = temp.path().join("public");
    let private = temp.path().join("private");
    let protected = temp.path().join("backups");
    fs::create_dir(&public).unwrap();
    fs::create_dir(&private).unwrap();
    fs::create_dir(&protected).unwrap();
    call(json!({"operation":"backgroundAssertRoots","storageRoot":public,"privateStorageRoot":private,"protectedPaths":[protected]})).unwrap();
    for request in [
        json!({"operation":"backgroundAssertRoots","storageRoot":public,"privateStorageRoot":public,"protectedPaths":[]}),
        json!({"operation":"backgroundAssertRoots","storageRoot":public,"privateStorageRoot":private,"protectedPaths":[public.join("backup")]}),
        json!({"operation":"backgroundAssertRoots","storageRoot":temp.path(),"privateStorageRoot":private,"protectedPaths":[]}),
        json!({"operation":"backgroundAssertRoots","storageRoot":std::env::current_dir().unwrap(),"privateStorageRoot":private,"protectedPaths":[]}),
    ] {
        assert!(call(request).is_err());
    }
    let layout = json!({"publicRelativeDirectory":"users","privateRelativeDirectory":"backgrounds","fileName":"background.avif"});
    assert_eq!(call(json!({"operation":"backgroundCollect","storageRoot":public,"location":"public","layout":layout})).unwrap(),json!([]));
    assert_eq!(call(json!({"operation":"backgroundCollect","storageRoot":temp.path().join("missing"),"location":"public","layout":layout})).unwrap(),json!([]));
    fs::create_dir_all(public.join("users/alice")).unwrap();
    fs::write(public.join("users/ignored"), b"not a user directory").unwrap();
    assert_eq!(call(json!({"operation":"backgroundCollect","storageRoot":public,"location":"public","layout":layout})).unwrap(),json!([]));
    assert!(call(json!({"operation":"backgroundCollect","storageRoot":public,"location":"public","layout":{"publicRelativeDirectory":"../escape","privateRelativeDirectory":"backgrounds","fileName":"background.avif"}})).is_err());
    fs::create_dir(public.join("users/alice/background.avif")).unwrap();
    assert!(call(json!({"operation":"backgroundCollect","storageRoot":public,"location":"public","layout":layout})).is_err());
}

#[test]
fn admission_reserves_persistently_releases_and_rejects_expired_or_corrupt_state() {
    let temp = tempfile::tempdir().unwrap();
    let directory = temp.path().join("lease");
    let result = call(
        json!({"operation":"admissionAcquire","directory":directory,"maximumUploadBytes":1024}),
    )
    .unwrap();
    call(json!({"operation":"admissionReserve","directory":directory,"token":result["token"],"byteLength":1024})).unwrap();
    let mut state: Value =
        serde_json::from_slice(&fs::read(directory.join("admission.json")).unwrap()).unwrap();
    assert_eq!(state["written"], 1024);
    state["deadline"] = json!(0);
    fs::write(
        directory.join("admission.json"),
        serde_json::to_vec(&state).unwrap(),
    )
    .unwrap();
    assert!(call(json!({"operation":"admissionReserve","directory":directory,"token":result["token"],"byteLength":1})).is_err());
    call(json!({"operation":"admissionRelease","directory":directory,"token":result["token"]}))
        .unwrap();
    assert!(!directory.exists());
    let result =
        call(json!({"operation":"admissionAcquire","directory":directory,"maximumUploadBytes":0}))
            .unwrap();
    fs::write(directory.join("admission.json"), b"corrupt").unwrap();
    assert!(
        call(json!({"operation":"admissionRelease","directory":directory,"token":result["token"]}))
            .is_err()
    );
    assert!(directory.exists());
    assert!(call(json!({"operation":"admissionAcquire","directory":temp.path().join("too-large"),"maximumUploadBytes":archive::MAX_ARCHIVE+1})).is_err());
}

#[test]
fn file_encryption_and_copy_are_bounded_exclusive_and_checksum_checked() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("plain");
    let encrypted = temp.path().join("encrypted");
    let restored = temp.path().join("restored");
    let copy = temp.path().join("copy");
    let content = vec![43; 200_000];
    fs::write(&source, &content).unwrap();
    let metadata =
        call(json!({"operation":"encrypt","sourcePath":source,"destinationPath":encrypted}))
            .unwrap();
    let decrypted=call(json!({"operation":"decrypt","sourcePath":encrypted,"destinationPath":restored,"expectedChecksumSha256":metadata["checksumSha256"]})).unwrap();
    assert_eq!(decrypted, metadata);
    assert_eq!(fs::read(&restored).unwrap(), content);
    let copied=call(json!({"operation":"copy","sourcePath":encrypted,"destinationPath":copy,"expectedChecksumSha256":metadata["checksumSha256"]})).unwrap();
    assert_eq!(copied["archiveSize"], metadata["archiveSize"]);
    assert_eq!(fs::read(&copy).unwrap(), fs::read(&encrypted).unwrap());
    assert!(
        call(json!({"operation":"copy","sourcePath":encrypted,"destinationPath":copy})).is_err()
    );
    let wrong = temp.path().join("wrong");
    assert!(call(json!({"operation":"copy","sourcePath":encrypted,"destinationPath":wrong,"expectedChecksumSha256":"0".repeat(64)})).is_err());
    assert!(!wrong.exists());
    assert!(
        call(json!({"operation":"authenticate","sourcePath":encrypted,"maximumBytes":1})).is_err()
    );
    let short = temp.path().join("short");
    fs::write(&short, b"short").unwrap();
    assert!(call(json!({"operation":"authenticate","sourcePath":short})).is_err());
    let limited = temp.path().join("limited");
    assert!(call(json!({"operation":"decrypt","sourcePath":encrypted,"destinationPath":limited,"maximumWriteBytes":1})).is_err());
    assert!(!limited.exists());
    assert!(call(json!({"operation":"unknown"})).is_err());
    assert!(
        archive::execute(
            json!({"operation":"authenticate","sourcePath":encrypted,"key":"invalid"}),
            &OperationContext::default()
        )
        .is_err()
    );
}

fn raw_entry(template: &[u8], name: &str, body: &[u8], kind: u8) -> Vec<u8> {
    let mut header = template[..512].to_vec();
    header[..100].fill(0);
    header[..name.len()].copy_from_slice(name.as_bytes());
    header[124..136].fill(0);
    header[124..135].copy_from_slice(format!("{:011o}", body.len()).as_bytes());
    header[156] = kind;
    header[157..257].fill(0);
    header[345..500].fill(0);
    checksum(&mut header);
    header.extend_from_slice(body);
    header.resize(header.len() + (512 - body.len() % 512) % 512, 0);
    header
}
fn body_entry(bytes: &[u8], name: &str) -> Vec<u8> {
    let mut offset = 0;
    loop {
        let header = &bytes[offset..offset + 512];
        let size = u64::from_str_radix(std::str::from_utf8(&header[124..135]).unwrap(), 8).unwrap()
            as usize;
        let end = header.iter().position(|b| *b == 0).unwrap_or(100).min(100);
        if &header[..end] == name.as_bytes() {
            return bytes[offset + 512..offset + 512 + size].to_vec();
        }
        offset += 512 + size.div_ceil(512) * 512;
    }
}
#[test]
fn tar_rejects_metadata_manipulation_path_collisions_and_unsupported_pax() {
    let temp = tempfile::tempdir().unwrap();
    let archive = fixture(temp.path(), false);
    let original = plaintext(temp.path(), &archive);
    let manifest = body_entry(&original, "manifest.json");
    let database = body_entry(&original, "database.dump");
    let integrity = body_entry(&original, "integrity.json");
    let package = |entries: Vec<(&str, Vec<u8>, u8)>| {
        let mut bytes = Vec::new();
        for (name, body, kind) in entries {
            bytes.extend_from_slice(&raw_entry(&original, name, &body, kind));
        }
        bytes.extend_from_slice(&[0; 1024]);
        bytes
    };
    let baseline = || {
        vec![
            ("manifest.json", manifest.clone(), b'0'),
            ("database.dump", database.clone(), b'0'),
        ]
    };
    for paths in [
        vec![("storage/a", b'0'), ("storage/a", b'0')],
        vec![("storage/A", b'0'), ("storage/a", b'0')],
        vec![("storage/a", b'0'), ("storage/a/child", b'0')],
        vec![("storage/a/child", b'0'), ("storage/a", b'0')],
        vec![("storage/Dir/a", b'0'), ("storage/dir/b", b'0')],
        vec![("storage/Dir/a", b'0'), ("storage/dir", b'5')],
    ] {
        let mut entries = baseline();
        for (path, kind) in paths {
            entries.push((path, vec![], kind));
        }
        entries.push(("integrity.json", integrity.clone(), b'0'));
        assert!(!check_tar(temp.path(), &package(entries)));
    }
    for pax in [
        b"11 uid=100\n".to_vec(),
        b"19 path=storage/a\n".to_vec(),
        b"999 path=a\n".to_vec(),
        b"x path=a\n".to_vec(),
        b"9 path=aX".to_vec(),
        b"9 path=a\n9 path=b\n".to_vec(),
        vec![0xff],
    ] {
        let mut entries = baseline();
        entries.push(("pax", pax, b'x'));
        entries.push(("storage/ignored", vec![], b'0'));
        entries.push(("integrity.json", integrity.clone(), b'0'));
        assert!(!check_tar(temp.path(), &package(entries)));
    }
    let mut entries = baseline();
    entries.push(("pax", b"18 path=storage/a\n".to_vec(), b'x'));
    assert!(!check_tar(temp.path(), &package(entries)));
    let mut entries = baseline();
    entries.push(("pax", b"18 path=storage/a\n".to_vec(), b'x'));
    entries.push(("pax", b"18 path=storage/b\n".to_vec(), b'x'));
    assert!(!check_tar(temp.path(), &package(entries)));
    for corrupted_manifest in [b"invalid JSON".to_vec(),br#"{"version":1,"createdAt":"2026-11-10T09:00:00.000Z","appVersion":"test","includesStorage":false}"#.to_vec(),br#"{"version":3,"createdAt":"invalid","appVersion":"test","includesStorage":false}"#.to_vec(),br#"{"version":3,"createdAt":"2026-11-10T09:00:00.000Z","appVersion":"test","includesStorage":true}"#.to_vec(),vec![b' ';65537]] {assert!(!check_tar(temp.path(),&package(vec![("manifest.json",corrupted_manifest,b'0'),("database.dump",database.clone(),b'0'),("integrity.json",integrity.clone(),b'0')])));}
    for corrupted_integrity in [
        b"invalid JSON".to_vec(),
        br#"{"version":1,"algorithm":"sha256","entryCount":2,"totalBytes":1,"hmacSha256":"wrong"}"#
            .to_vec(),
        vec![b' '; 65537],
    ] {
        let mut entries = baseline();
        entries.push(("integrity.json", corrupted_integrity, b'0'));
        assert!(!check_tar(temp.path(), &package(entries)));
    }
    assert!(!check_tar(temp.path(), &package(baseline())));
    assert!(!check_tar(
        temp.path(),
        &package(vec![
            ("database.dump", database.clone(), b'0'),
            ("integrity.json", integrity.clone(), b'0')
        ])
    ));
    assert!(!check_tar(
        temp.path(),
        &package(vec![
            ("manifest.json", manifest.clone(), b'0'),
            ("database.dump", vec![], b'0'),
            ("integrity.json", integrity.clone(), b'0')
        ])
    ));
    let mut entries = baseline();
    entries.push(("integrity.json", integrity.clone(), b'0'));
    entries.push(("storage/extra", vec![], b'0'));
    assert!(!check_tar(temp.path(), &package(entries)));
    let mut corrupt = original.clone();
    corrupt[512] ^= 1;
    assert!(!check_tar(temp.path(), &corrupt));
    for (field, value) in [(148, b'8'), (124, b'-'), (124, 0xff)] {
        let mut corrupt = original.clone();
        corrupt[field] = value;
        if field != 148 {
            checksum(&mut corrupt[..512]);
        }
        assert!(!check_tar(temp.path(), &corrupt));
    }
    let mut corrupt = original.clone();
    corrupt[156] = b'5';
    checksum(&mut corrupt[..512]);
    assert!(!check_tar(temp.path(), &corrupt));
}

#[test]
fn creation_validates_manifests_source_types_collisions_and_size_before_streaming() {
    let temp = tempfile::tempdir().unwrap();
    let storage = temp.path().join("storage");
    fs::create_dir(&storage).unwrap();
    let dump = temp.path().join("dump");
    fs::write(&dump, b"PGDMP").unwrap();
    let valid = json!({"version":3,"createdAt":"2026-11-10T09:00:00.000Z","appVersion":"test","includesStorage":true,"privateBackgroundsVersion":1});
    let output = temp.path().join("output");
    for manifest in [
        Value::Null,
        json!({"version":3}),
        json!({"version":3,"createdAt":"2026-11-10T09:00:00.000Z","appVersion":"","includesStorage":false}),
        json!({"version":3,"createdAt":"2026-11-10T09:00:00.000Z","appVersion":"test","includesStorage":false,"extra":true}),
    ] {
        assert!(call(json!({"operation":"create","databaseDumpPath":dump,"destinationPath":output,"manifest":manifest})).is_err());
    }
    assert!(call(json!({"operation":"create","databaseDumpPath":dump,"destinationPath":output,"manifest":valid,"manifestContent":"{}","storageRoot":storage})).is_err());
    let mut huge = valid.clone();
    huge["appVersion"] = json!("a".repeat(65536));
    assert!(call(json!({"operation":"create","databaseDumpPath":dump,"destinationPath":output,"manifest":huge,"storageRoot":storage})).is_err());
    fs::write(storage.join("A"), b"first").unwrap();
    #[cfg(unix)]
    {
        fs::write(storage.join("a"), b"second").unwrap();
        assert!(call(json!({"operation":"collect","storageRoot":storage})).is_err());
        fs::remove_file(storage.join("a")).unwrap();
    }
    assert!(call(json!({"operation":"collect","storageRoot":storage,"privateEntries":[{"path":"storage/A","type":"directory","size":0}]})).is_err());
    assert!(call(json!({"operation":"collect","storageRoot":storage,"privateEntries":[{"path":"storage/A/child","type":"file","size":5,"absolutePath":dump}]})).is_err());
    fs::write(&dump, b"").unwrap();
    assert!(call(json!({"operation":"create","databaseDumpPath":dump,"destinationPath":output,"manifest":valid,"storageRoot":storage})).is_err());
    #[cfg(unix)]
    {
        let file = fs::OpenOptions::new().write(true).open(&dump).unwrap();
        file.set_len(archive::MAX_CONTENT).unwrap();
        drop(file);
        assert!(call(json!({"operation":"create","databaseDumpPath":dump,"destinationPath":output,"manifest":valid,"storageRoot":storage})).is_err());
    }
    assert!(!output.exists());
    let missing_capacity = temp.path().join("missing-capacity");
    let plain = temp.path().join("plain");
    fs::write(&plain, b"bounded fixture").unwrap();
    let encrypted = temp.path().join("encrypted");
    call(json!({"operation":"encrypt","sourcePath":plain,"destinationPath":encrypted})).unwrap();
    for capacity in [missing_capacity, plain] {
        let failure=call(json!({"operation":"decrypt","sourcePath":encrypted,"destinationPath":output,"capacityDirectory":capacity})).unwrap_err();
        assert_eq!(failure.code, "ARCHIVE_CAPACITY_UNAVAILABLE");
    }
    assert!(!output.exists());
}

#[test]
#[cfg(unix)]
fn refuses_symlinks_and_hardlinks_in_sources_storage_and_backgrounds() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let original = temp.path().join("original");
    fs::write(&original, b"original file").unwrap();
    let link = temp.path().join("link");
    symlink(&original, &link).unwrap();
    assert!(call(json!({"operation":"encrypt","sourcePath":link,"destinationPath":temp.path().join("output")})).is_err());
    let hard = temp.path().join("hard");
    fs::hard_link(&original, &hard).unwrap();
    assert!(call(json!({"operation":"encrypt","sourcePath":original,"destinationPath":temp.path().join("output")})).is_err());
    fs::remove_file(hard).unwrap();
    let encrypted = temp.path().join("valid-envelope");
    call(json!({"operation":"encrypt","sourcePath":original,"destinationPath":encrypted})).unwrap();
    let capacity_link = temp.path().join("capacity-link");
    symlink(temp.path(), &capacity_link).unwrap();
    let failure=call(json!({"operation":"decrypt","sourcePath":encrypted,"destinationPath":temp.path().join("decrypted"),"capacityDirectory":capacity_link})).unwrap_err();
    assert_eq!(failure.code, "ARCHIVE_CAPACITY_UNAVAILABLE");
    let storage = temp.path().join("storage");
    fs::create_dir(&storage).unwrap();
    symlink(&original, storage.join("link")).unwrap();
    assert!(call(json!({"operation":"collect","storageRoot":storage})).is_err());
    let background = temp.path().join("background");
    fs::create_dir_all(background.join("users")).unwrap();
    symlink(&storage, background.join("users/alice")).unwrap();
    let layout = json!({"publicRelativeDirectory":"users","privateRelativeDirectory":"backgrounds","fileName":"background.avif"});
    assert!(call(json!({"operation":"backgroundCollect","storageRoot":background,"location":"public","layout":layout})).is_err());
}

#[test]
fn pax_uses_the_final_validated_path_and_accepts_positive_base256_sizes() {
    let temp = tempfile::tempdir().unwrap();
    let archive = fixture(temp.path(), false);
    let original = plaintext(temp.path(), &archive);
    let manifest = body_entry(&original, "manifest.json");
    let database = body_entry(&original, "database.dump");
    let integrity = body_entry(&original, "integrity.json");
    fn pax(value: &str) -> String {
        let record = format!("path={value}\n");
        let mut size = record.len() + 2;
        loop {
            let next = record.len() + size.to_string().len() + 1;
            if next == size {
                break;
            }
            size = next;
        }
        format!("{size} {record}")
    }
    let mut bytes = raw_entry(&original, "manifest.json", &manifest, b'0');
    bytes.extend_from_slice(&raw_entry(
        &original,
        "pax",
        format!("{}{}", pax("../ignored"), pax("database.dump")).as_bytes(),
        b'x',
    ));
    bytes.extend_from_slice(&raw_entry(&original, "ignored-name", &database, b'0'));
    bytes.extend_from_slice(&raw_entry(&original, "integrity.json", &integrity, b'0'));
    bytes.extend_from_slice(&[0; 1024]);
    assert!(check_tar(temp.path(), &bytes));
    let mut bytes = original.clone();
    bytes[124..136].fill(0);
    bytes[124] = 128;
    bytes[128..136].copy_from_slice(&(manifest.len() as u64).to_be_bytes());
    checksum(&mut bytes[..512]);
    assert!(check_tar(temp.path(), &bytes));
    bytes[125] = 255;
    checksum(&mut bytes[..512]);
    assert!(!check_tar(temp.path(), &bytes));
    let mut bytes = original.clone();
    bytes[0] = 255;
    checksum(&mut bytes[..512]);
    assert!(!check_tar(temp.path(), &bytes));
}

#[test]
fn envelopes_handle_empty_partial_and_multichunk_messages_without_size_drift() {
    let temp = tempfile::tempdir().unwrap();
    for length in [0, 1, 15, 16, 17, 65535, 65536, 65537, 200003] {
        let source = temp.path().join(format!("source-{length}"));
        let destination = temp.path().join(format!("envelope-{length}"));
        let output = temp.path().join(format!("restored-{length}"));
        let bytes: Vec<_> = (0..length).map(|index| (index % 251) as u8).collect();
        fs::write(&source, &bytes).unwrap();
        let encrypted =
            call(json!({"operation":"encrypt","sourcePath":source,"destinationPath":destination}))
                .unwrap();
        let decrypted=call(json!({"operation":"decrypt","sourcePath":destination,"destinationPath":output,"maximumWriteBytes":length,"capacityDirectory":temp.path()})).unwrap();
        assert_eq!(encrypted, decrypted);
        assert_eq!(encrypted["archiveSize"], length + 70);
        assert_eq!(fs::read(output).unwrap(), bytes);
    }
    assert!(call(json!({"operation":"validateKey"})).is_ok());
    assert!(archive::execute(json!({"operation":"validateKey","key":base64::engine::general_purpose::STANDARD.encode([0;31])}),&OperationContext::default()).is_err());
    assert!(
        archive::execute(
            json!({"operation":"validateKey","key":"invalid"}),
            &OperationContext::default()
        )
        .is_err()
    );
}

#[test]
fn import_file_lock_waits_are_cancellable_and_never_steal_foreign_locks() {
    let temp = tempfile::tempdir().unwrap();
    let directory = temp.path().join("admission");
    let admission = call(
        json!({"operation":"admissionAcquire","directory":directory,"maximumUploadBytes":1024}),
    )
    .unwrap();
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(directory.join("admission.json"))
        .unwrap();
    file.lock().unwrap();
    let context = OperationContext::default();
    let cancellation = context.clone();
    let thread = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(75));
        cancellation.cancel();
    });
    let request = json!({"operation":"admissionReserve","directory":directory,"token":admission["token"],"byteLength":1});
    let result = archive::execute(request, &context);
    assert_eq!(result.unwrap_err().code, "CORE_CANCELLED");
    thread.join().unwrap();
    file.unlock().unwrap();
    call(json!({"operation":"admissionRelease","directory":directory,"token":admission["token"]}))
        .unwrap();
    assert!(!directory.exists());
}

#[test]
#[cfg(unix)]
fn authentication_binds_every_source_identity_field_and_rejects_in_place_changes() {
    use std::os::unix::fs::MetadataExt;
    let temp = tempfile::tempdir().unwrap();
    let archive = fixture(temp.path(), false);
    let metadata = fs::metadata(&archive).unwrap();
    let expected = json!({"dev":metadata.dev().to_string(),"ino":metadata.ino().to_string(),"size":metadata.len().to_string(),"mtimeNs":(metadata.mtime() as i128*1_000_000_000+metadata.mtime_nsec() as i128).to_string(),"ctimeNs":(metadata.ctime() as i128*1_000_000_000+metadata.ctime_nsec() as i128).to_string()});
    call(
        json!({"operation":"authenticate","sourcePath":archive,"expectedSourceIdentity":expected}),
    )
    .unwrap();
    for field in ["dev", "ino", "size", "mtimeNs", "ctimeNs"] {
        let mut wrong = expected.clone();
        wrong[field] = json!("0");
        assert!(call(json!({"operation":"authenticate","sourcePath":archive,"expectedSourceIdentity":wrong})).is_err(),"accepted wrong {field}");
    }
    let encoded = fs::read(&archive).unwrap();
    fs::write(&archive, &encoded).unwrap();
    // A same-content rewrite can retain both timestamps within one filesystem
    // clock tick. Make the identity change explicit instead of relying on time.
    let modified = metadata.modified().unwrap() - std::time::Duration::from_secs(2);
    fs::OpenOptions::new()
        .write(true)
        .open(&archive)
        .unwrap()
        .set_modified(modified)
        .unwrap();
    assert_ne!(
        fs::metadata(&archive).unwrap().modified().unwrap(),
        metadata.modified().unwrap()
    );
    assert!(call(json!({"operation":"authenticate","sourcePath":archive,"expectedSourceIdentity":expected})).is_err());
}

#[test]
fn private_overlay_normalizes_paths_and_rejects_duplicate_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let storage = temp.path().join("storage");
    fs::create_dir(&storage).unwrap();
    fs::write(storage.join("Ölbild.txt"), b"public").unwrap();
    let private = temp.path().join("private");
    fs::write(&private, b"private").unwrap();
    let overlay =
        json!({"path":"storage/O\u{308}lbild.txt","size":7,"type":"file","absolutePath":private});
    let entries =
        call(json!({"operation":"collect","storageRoot":storage,"privateEntries":[overlay]}))
            .unwrap();
    let entries = entries.as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[1]["path"], "storage/Ölbild.txt");
    assert_eq!(entries[1]["size"], 7);
    assert!(
        call(
            json!({"operation":"collect","storageRoot":storage,"privateEntries":[overlay,overlay]})
        )
        .is_err()
    );
}

#[test]
fn archive_cli_runs_real_file_operations_and_returns_bounded_typed_errors() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    fn invoke(request: Value) -> (bool, Vec<Value>) {
        let mut child = Command::new(env!("CARGO_BIN_EXE_marketplace-archive"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(serde_json::to_string(&request).unwrap().as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        let messages = String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        (output.status.success(), messages)
    }
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("plain");
    let destination = temp.path().join("encrypted");
    fs::write(&source, b"CLI source with a partial final AES block").unwrap();
    let (success, messages) = invoke(
        json!({"operation":"encrypt","key":key(),"sourcePath":source,"destinationPath":destination}),
    );
    assert!(success);
    assert_eq!(messages.last().unwrap()["type"], "result");
    let checksum = messages.last().unwrap()["result"]["checksumSha256"].clone();
    let (success, messages) = invoke(
        json!({"operation":"authenticate","key":key(),"sourcePath":destination,"expectedChecksumSha256":checksum}),
    );
    assert!(success);
    assert!(messages.iter().any(|message| message["type"] == "progress"));
    assert_eq!(
        messages.last().unwrap()["result"]["plaintextSize"],
        b"CLI source with a partial final AES block".len()
    );
    let (success, messages) = invoke(
        json!({"operation":"authenticate","key":key(),"sourcePath":destination,"expectedChecksumSha256":"0".repeat(64)}),
    );
    assert!(!success);
    assert_eq!(messages.last().unwrap()["error"]["code"], "ARCHIVE_INVALID");
    let (success, messages) =
        invoke(json!({"operation":"validateEntry","path":"storage/file","kind":"file","size":-1}));
    assert!(!success);
    assert_eq!(messages.last().unwrap()["error"]["code"], "ARCHIVE_INVALID");
    let (success, messages) = invoke(json!({}));
    assert!(!success);
    assert_eq!(messages.last().unwrap()["error"]["code"], "ARCHIVE_INVALID");
}

#[test]
#[cfg(unix)]
fn cli_cancellation_preserves_quarantined_plaintext_when_cleanup_cannot_be_confirmed() {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::process::{Command, Stdio};
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("sparse-untrusted.enc");
    let staging = temp.path().join("staging");
    fs::create_dir(&staging).unwrap();
    let mut file = fs::File::create(&source).unwrap();
    file.write_all(b"TDBAKENC\x01\x01").unwrap();
    file.write_all(&[0; 44]).unwrap();
    file.set_len(512 * 1024 * 1024 + 70).unwrap();
    drop(file);
    let cancel = temp.path().join("cancel");
    let mut child = Command::new(env!("CARGO_BIN_EXE_marketplace-archive"))
        .env("MARKETPLACE_CORE_CANCEL_FILE", &cancel)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let request = json!({"operation":"validate","key":key(),"sourcePath":source,"temporaryDirectory":staging});
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(&request).unwrap().as_bytes())
        .unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut first = String::new();
    reader.read_line(&mut first).unwrap();
    let progress: Value = serde_json::from_str(&first).unwrap();
    assert_eq!(progress["type"], "progress");
    let plaintext_directory = fs::read_dir(&staging)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let quarantined = temp.path().join("quarantined");
    fs::rename(&plaintext_directory, &quarantined).unwrap();
    fs::write(
        &plaintext_directory,
        b"foreign replacement: never delete as owned plaintext",
    )
    .unwrap();
    fs::write(&cancel, b"cancel").unwrap();
    let mut output = String::new();
    reader.read_to_string(&mut output).unwrap();
    assert!(!child.wait().unwrap().success());
    let terminal: Value = serde_json::from_str(output.lines().last().unwrap()).unwrap();
    assert_eq!(terminal["error"]["code"], "ARCHIVE_CLEANUP_INCOMPLETE");
    assert_eq!(
        fs::read(&plaintext_directory).unwrap(),
        b"foreign replacement: never delete as owned plaintext"
    );
    assert!(quarantined.join("archive.tar").exists());
}

#[test]
fn malformed_requests_manifest_versions_and_background_metadata_fail_closed() {
    let temp = tempfile::tempdir().unwrap();
    let public = temp.path().join("public");
    let private = temp.path().join("private");
    fs::create_dir(&public).unwrap();
    fs::create_dir(&private).unwrap();
    for request in [
        json!({}),
        json!({"operation":""}),
        json!({"operation":"validateEntry","path":"storage/a","size":-1,"kind":"file"}),
        json!({"operation":"create"}),
        json!({"operation":"backgroundAssertRoots","storageRoot":public,"privateStorageRoot":private}),
        json!({"operation":"backgroundAssertRoots","storageRoot":public,"privateStorageRoot":private,"protectedPaths":[42]}),
        json!({"operation":"backgroundAssertRoots","storageRoot":temp.path().join("missing/.."),"privateStorageRoot":private,"protectedPaths":[]}),
        json!({"operation":"backgroundAssertRoots","storageRoot":"relative-missing-root","privateStorageRoot":private,"protectedPaths":[]}),
    ] {
        assert!(call(request).is_err());
    }
    let manifest =
        json!({"createdAt":"2026-11-10T09:00:00Z","appVersion":"test","includesStorage":false});
    assert!(call(json!({"operation":"create","manifest":manifest})).is_err());
    for value in [
        "2026-11-10t09:00:00Z",
        "2026-11-10T09:00:60Z",
        "2026-02-30T09:00:00Z",
        "2026-11-10T09:00:00+00:00",
    ] {
        let manifest =
            json!({"version":3,"createdAt":value,"appVersion":"test","includesStorage":false});
        assert!(call(json!({"operation":"create","manifest":manifest})).is_err());
    }
}

#[test]
#[cfg(unix)]
fn rejects_non_utf8_public_and_private_user_paths_without_reading_their_contents() {
    use std::os::unix::ffi::OsStringExt;
    let temp = tempfile::tempdir().unwrap();
    let public = temp.path().join("public");
    fs::create_dir(&public).unwrap();
    fs::write(
        public.join(std::ffi::OsString::from_vec(vec![255])),
        b"private bytes",
    )
    .unwrap();
    assert!(call(json!({"operation":"collect","storageRoot":public})).is_err());
    let root = temp.path().join("private");
    let users = root.join("backgrounds");
    let invalid = users.join(std::ffi::OsString::from_vec(vec![255]));
    fs::create_dir_all(&invalid).unwrap();
    fs::write(invalid.join("image.webp"), b"private bytes").unwrap();
    let layout = json!({"publicRelativeDirectory":"images/user","privateRelativeDirectory":"backgrounds","fileName":"image.webp"});
    assert!(call(json!({"operation":"backgroundCollect","storageRoot":root,"location":"private","layout":layout})).is_err());
}
