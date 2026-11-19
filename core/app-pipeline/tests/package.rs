use std::fs;
use std::io;

use marketplace_app_pipeline::package::execute;
use marketplace_artifacts::digest;
use serde_json::{Value, json};
use tempfile::TempDir;

const SOURCE_ID: &str = "8001234";
const COMMIT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn manifest(target: &str) -> Value {
    let mut document: Value = serde_json::from_str(include_str!(
        "../../../.github/scripts/ci/fixtures/app-candidate/v1/manifest.json"
    ))
    .unwrap();
    document["target"] = target.into();
    document["source"] = json!({"repositoryId": SOURCE_ID, "commit": COMMIT});
    document
}

fn number(field: &mut [u8], value: usize) {
    let digits = field.len() - 1;
    field[..digits].copy_from_slice(format!("{value:0digits$o}").as_bytes());
    field[digits] = 0;
}

fn entry(output: &mut Vec<u8>, path: &str, mode: usize, kind: u8, body: &[u8]) {
    let mut header = [0; 512];
    header[..path.len()].copy_from_slice(path.as_bytes());
    number(&mut header[100..108], mode);
    number(&mut header[108..116], 0);
    number(&mut header[116..124], 0);
    number(&mut header[124..136], body.len());
    number(&mut header[136..148], 0);
    header[148..156].fill(b' ');
    header[156] = kind;
    header[257..265].copy_from_slice(b"ustar\x0000");
    let checksum = header.iter().map(|&byte| usize::from(byte)).sum();
    number(&mut header[148..155], checksum);
    output.extend_from_slice(&header);
    output.extend_from_slice(body);
    output.resize(output.len().next_multiple_of(512), 0);
}

fn put16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn put64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn elf(machine: u16, dynamic: bool) -> Vec<u8> {
    let mut bytes = vec![0; if dynamic { 512 } else { 128 }];
    let length = bytes.len() as u64;
    bytes[..7].copy_from_slice(b"\x7fELF\x02\x01\x01");
    put16(&mut bytes, 16, if dynamic { 3 } else { 2 });
    put16(&mut bytes, 18, machine);
    put32(&mut bytes, 20, 1);
    put64(&mut bytes, 24, 0x400078);
    put64(&mut bytes, 32, 64);
    put16(&mut bytes, 52, 64);
    put16(&mut bytes, 54, 56);
    put16(&mut bytes, 56, if dynamic { 3 } else { 1 });

    let mut segment = |index: usize, kind: u32, offset: u64, length: u64| {
        let start = 64 + index * 56;
        put32(&mut bytes, start, kind);
        put32(&mut bytes, start + 4, if kind == 1 { 5 } else { 4 });
        put64(&mut bytes, start + 8, offset);
        put64(&mut bytes, start + 16, 0x400000 + offset);
        put64(&mut bytes, start + 32, length);
        put64(&mut bytes, start + 40, length);
    };
    segment(0, 1, 0, length);
    if dynamic {
        let interpreter: &[u8] = if machine == 62 {
            b"/lib64/ld-linux-x86-64.so.2\0"
        } else {
            b"/lib/ld-linux-aarch64.so.1\0"
        };
        let strings = b"libstdc++.so.6\0GLIBCXX_3.4.33\0";
        segment(1, 3, 0xe8, interpreter.len() as u64);
        segment(2, 2, 0x110, 6 * 16);
        bytes[0xe8..0xe8 + interpreter.len()].copy_from_slice(interpreter);
        bytes[0x180..0x180 + strings.len()].copy_from_slice(strings);
        let tags = [
            (5, 0x400180),
            (10, strings.len() as u64),
            (1, 0),
            (0x6fff_fffe, 0x4001c0),
            (0x6fff_ffff, 1),
            (0, 0),
        ];
        for (index, &(tag, value)) in tags.iter().enumerate() {
            put64(&mut bytes, 0x110 + 16 * index, tag);
            put64(&mut bytes, 0x118 + 16 * index, value);
        }
        put16(&mut bytes, 0x1c0, 1);
        put16(&mut bytes, 0x1c2, 1);
        put32(&mut bytes, 0x1c8, 16);
        put32(&mut bytes, 0x1d0, 0x0297f843);
        put16(&mut bytes, 0x1d6, 2);
        put32(&mut bytes, 0x1d8, 15);
    }
    bytes
}

fn required_entries(raw: &[u8], machine: u16, schema: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::new();
    entry(&mut bytes, "./", 0o755, b'5', &[]);
    entry(&mut bytes, "./app.json", 0o644, b'0', raw);
    entry(&mut bytes, "./bin/app", 0o755, b'0', &elf(machine, false));
    entry(
        &mut bytes,
        "./LICENSE",
        0o644,
        b'0',
        b"MIT fixture license\n",
    );
    entry(
        &mut bytes,
        "./api/openapi.json",
        0o644,
        b'0',
        br#"{"openapi":"3.1.0","info":{"title":"Fixture","version":"1"},"paths":{}}"#,
    );
    entry(&mut bytes, "./schemas/settings.json", 0o644, b'0', schema);
    entry(
        &mut bytes,
        "./ui/index.html",
        0o644,
        b'0',
        b"<title>Fixture</title>",
    );
    entry(
        &mut bytes,
        "./migrations/initialize.sql",
        0o644,
        b'0',
        b"SELECT 1;",
    );
    bytes
}

fn validate(directory: &TempDir, mut bytes: Vec<u8>, target: &str) -> io::Result<Value> {
    bytes.resize(bytes.len() + 1024, 0);
    let archive = directory.path().join("package.tar");
    fs::write(&archive, bytes)?;
    execute(
        "validate-package",
        json!({
            "archivePath": archive,
            "outputDirectory": directory.path().join("package"),
            "source": {"repositoryId": SOURCE_ID, "commit": COMMIT},
            "target": target,
        }),
    )
}

#[test]
fn admits_both_targets_with_exact_manifest_bytes_and_exclusive_output() {
    for (target, machine) in [("linux-amd64", 62), ("linux-arm64", 183)] {
        let directory = TempDir::new().unwrap();
        let manifest = manifest(target);
        let raw = format!("{}\n", serde_json::to_string_pretty(&manifest).unwrap());
        let archive = required_entries(
            raw.as_bytes(),
            machine,
            br##"{"properties":{"$ref":{"$ref":"#/properties/name"},"name":{"type":"string"}}}"##,
        );
        let result = validate(&directory, archive.clone(), target).unwrap();
        let output = directory.path().join("package");
        assert_eq!(
            result,
            json!({"manifest": manifest, "manifestSha256": digest(raw.as_bytes()), "linkage": []})
        );
        assert_eq!(fs::read(output.join("app.json")).unwrap(), raw.as_bytes());
        assert_eq!(
            fs::read(output.join("bin/app")).unwrap(),
            elf(machine, false)
        );
        assert!(
            matches!(validate(&directory, archive, target), Err(error) if error.kind() == io::ErrorKind::AlreadyExists)
        );
    }
}

#[test]
fn rejects_references_and_unsafe_archive_entries_without_leaving_stage() {
    let target = "linux-amd64";
    let raw = serde_json::to_vec(&manifest(target)).unwrap();
    for (schema, extra, expected) in [
        (r#"{"$ref":"../unauthorized.json"}"#, None, "package-local"),
        (
            r##"{"$ref":"#/properties/missing"}"##,
            None,
            "does not resolve",
        ),
        (
            r#"{"type":true,"\u0074ype":false}"#,
            None,
            "ambiguous candidate JSON",
        ),
        (
            "{}",
            Some("./UI/asset.css"),
            "outside the candidate package layout",
        ),
        ("{}", Some("./ui/INDEX.html"), "Conflicting or duplicate"),
        ("{}", Some("./ui/../outside"), "Unsafe ustar"),
    ] {
        let directory = TempDir::new().unwrap();
        let mut archive = required_entries(&raw, 62, schema.as_bytes());
        if let Some(path) = extra {
            entry(&mut archive, path, 0o644, b'0', b"fixture");
        }
        let error = validate(&directory, archive, target).unwrap_err();
        assert!(error.to_string().contains(expected), "{error}");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}

#[test]
fn verifies_elf_loader_versions_for_both_architectures() {
    for (target, machine, loader) in [
        ("linux-amd64", 62, "ld-linux-x86-64.so.2"),
        ("linux-arm64", 183, "ld-linux-aarch64.so.1"),
    ] {
        let directory = TempDir::new().unwrap();
        let binary = directory.path().join("bin");
        fs::write(&binary, elf(machine, true)).unwrap();
        let mut linkage = execute(
            "inspect-elf",
            json!({"inputPath": binary, "target": target}),
        )
        .unwrap();
        assert_eq!(linkage["needed"], json!(["libstdc++.so.6"]));
        assert_eq!(
            linkage["versions"],
            json!({"libstdc++.so.6":["GLIBCXX_3.4.33"]})
        );
        linkage["path"] = "bin/app".into();
        assert_eq!(execute("verify-package-abi", json!({
            "linkage": [linkage],
            "applianceLibraryVersions": {(loader): [], "libstdc++.so.6": ["GLIBCXX_3.4.33"]},
        })).unwrap(), Value::Null);
        let unavailable = execute(
            "verify-package-abi",
            json!({
                "linkage": [linkage],
                "applianceLibraryVersions": {(loader): [], "libstdc++.so.6": ["GLIBCXX_3.4.34"]},
            }),
        )
        .unwrap_err();
        assert!(
            unavailable
                .to_string()
                .contains("symbol version is unavailable")
        );
    }
}

#[test]
fn promotes_only_one_package_when_publishers_race() {
    use std::sync::Barrier;
    use std::thread;

    let directory = TempDir::new().unwrap();
    let output = directory.path().join("published");
    let barrier = Barrier::new(2);
    let attempt = |name: &str| {
        let staging = directory.path().join(name);
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("marker"), name).unwrap();
        barrier.wait();
        execute(
            "promote-package",
            json!({"stagingPath": staging, "outputDirectory": output}),
        )
        .is_ok()
    };
    let (first, second) = thread::scope(|scope| {
        let first = scope.spawn(|| attempt("first"));
        let second = attempt("second");
        (first.join().unwrap(), second)
    });
    assert_ne!(first, second);
    assert_eq!(
        fs::read_to_string(output.join("marker")).unwrap(),
        if first { "first" } else { "second" }
    );
}

#[test]
fn zstd_output_has_a_checked_frame_and_decode_budget() {
    let directory = TempDir::new().unwrap();
    let input = directory.path().join("package.tar");
    let compressed = directory.path().join("package.tar.zst");
    let output = directory.path().join("package.out.tar");
    let original = b"candidate archive block\n".repeat(8192);
    fs::write(&input, &original).unwrap();
    execute(
        "compress-package",
        json!({"inputPath": input, "outputPath": compressed}),
    )
    .unwrap();
    let mut frame = fs::read(&compressed).unwrap();
    assert_eq!(&frame[..4], b"\x28\xb5\x2f\xfd");
    assert_ne!(frame[4] & 4, 0);

    let too_small = execute(
        "decompress-package",
        json!({
            "inputPath": compressed, "outputPath": output, "maximumBytes": original.len() - 1,
        }),
    );
    assert!(too_small.is_err());
    assert!(!output.exists());
    let result = execute(
        "decompress-package",
        json!({"inputPath": compressed, "outputPath": output}),
    )
    .unwrap();
    assert_eq!(
        result,
        json!({"sizeBytes": original.len(), "sha256": digest(&original)})
    );
    assert_eq!(fs::read(&output).unwrap(), original);

    *frame.last_mut().unwrap() ^= 1;
    fs::write(&compressed, frame).unwrap();
    let damaged = directory.path().join("damaged.tar");
    assert!(
        execute(
            "decompress-package",
            json!({"inputPath": compressed, "outputPath": damaged})
        )
        .is_err()
    );
    assert!(!damaged.exists());
}
