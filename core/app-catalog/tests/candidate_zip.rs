use std::fs;
use std::io::{Cursor, Seek, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const CONTENT: &[u8] = b"synthetic artifact payload";
const LIMITS: &[u8] = br#"{"candidate.json":512,"validation-report.json":512}"#;
const ONE_LIMIT: &[u8] = br#"{"candidate.json":512}"#;
const FILES: [(&str, &[u8]); 2] = [
    ("candidate.json", CONTENT),
    ("validation-report.json", b"report"),
];

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "marketplace-candidate-zip-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("out")).unwrap();
        Self(root)
    }

    fn extract(&self, zip: &[u8], limits: &[u8]) -> bool {
        let archive = self.0.join("artifact.zip");
        fs::write(&archive, zip).unwrap();
        run(
            &[
                Path::new("extract-candidate"),
                &archive,
                &self.0.join("out"),
            ],
            limits,
        )
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn run(args: &[&Path], limits: &[u8]) -> bool {
    let mut command = Command::new(env!("CARGO_BIN_EXE_marketplace-app-catalog"));
    command
        .args(args)
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(profile) = std::env::var_os("LLVM_PROFILE_FILE") {
        command.env("LLVM_PROFILE_FILE", profile);
    }
    let mut child = command.spawn().unwrap();
    if !limits.is_empty() {
        child.stdin.take().unwrap().write_all(limits).unwrap();
    }
    let output = child.wait_with_output().unwrap();
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
    output.status.success()
}

fn fill(
    writer: &mut ZipWriter<impl Write + Seek>,
    files: &[(&str, &[u8])],
    method: CompressionMethod,
) {
    for (name, bytes) in files {
        writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(method),
            )
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
}

fn zip(files: &[(&str, &[u8])], method: CompressionMethod) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    fill(&mut writer, files, method);
    writer.finish().unwrap().into_inner()
}

fn marker(bytes: &[u8], signature: &[u8]) -> usize {
    bytes
        .windows(signature.len())
        .position(|window| window == signature)
        .unwrap()
}

fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_u64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

#[test]
fn extracts_stored_and_streamed_deflate_files_without_signing_keys() {
    let stored = zip(&FILES, CompressionMethod::Stored);
    let mut stream = ZipWriter::new_stream(Vec::new());
    fill(&mut stream, &FILES, CompressionMethod::Deflated);
    let deflated = stream.finish().unwrap().into_inner();
    assert_eq!(deflated[6] & 8, 8);
    for archive in [stored, deflated] {
        let fixture = Fixture::new();
        assert!(fixture.extract(&archive, LIMITS));
        for (name, expected) in FILES {
            assert_eq!(
                fs::read(fixture.0.join("out").join(name)).unwrap(),
                expected
            );
        }
    }
}

#[test]
fn admits_only_an_exact_bounded_member_set() {
    // Use same-length names so the patched central directory remains well-formed.
    let mut duplicate = zip(
        &[("candidate.json", CONTENT), ("another01.json", b"report")],
        CompressionMethod::Stored,
    );
    let first = marker(&duplicate, b"PK\x01\x02");
    let second = first + 46 + "candidate.json".len();
    assert_eq!(&duplicate[second..second + 4], b"PK\x01\x02");
    duplicate[second + 46..second + 60].copy_from_slice(b"candidate.json");

    let mut hidden = zip(&FILES, CompressionMethod::Stored);
    let end = marker(&hidden, b"PK\x05\x06");
    write_u16(&mut hidden, end + 8, 1);
    write_u16(&mut hidden, end + 10, 1);
    let bad_sets = [
        (zip(&FILES, CompressionMethod::Stored), ONE_LIMIT),
        (hidden, ONE_LIMIT),
        (
            duplicate,
            br#"{"candidate.json":512,"another01.json":512}"#.as_slice(),
        ),
        (
            zip(&[("../candidate.json", CONTENT)], CompressionMethod::Stored),
            ONE_LIMIT,
        ),
        (
            zip(&[("candidate.json", b"")], CompressionMethod::Stored),
            ONE_LIMIT,
        ),
        (
            zip(&FILES[..1], CompressionMethod::Stored),
            br#"{"candidate.json":1}"#.as_slice(),
        ),
    ];
    for (archive, limits) in bad_sets {
        let fixture = Fixture::new();
        assert!(!fixture.extract(&archive, limits));
        assert_eq!(fs::read_dir(fixture.0.join("out")).unwrap().count(), 0);
    }
}

#[test]
fn rejects_disagreeing_headers_special_modes_and_false_stream_lengths() {
    let original = zip(&FILES[..1], CompressionMethod::Deflated);
    let central = marker(&original, b"PK\x01\x02");
    for change in [
        "name",
        "symlink",
        "encrypted",
        "codec",
        "crc",
        "longer",
        "shorter",
        "truncated",
    ] {
        let mut archive = original.clone();
        match change {
            "name" => archive[30] = b'g',
            "symlink" => write_u32(&mut archive, central + 38, 0o120777 << 16),
            "encrypted" => {
                archive[6] |= 1;
                archive[central + 8] |= 1;
            }
            "codec" => {
                write_u16(&mut archive, 8, 12);
                write_u16(&mut archive, central + 10, 12);
            }
            "crc" => {
                archive[14] ^= 1;
                archive[central + 16] ^= 1;
            }
            "truncated" => {
                let compressed = u32::from_le_bytes(archive[18..22].try_into().unwrap()) - 1;
                write_u32(&mut archive, 18, compressed);
                write_u32(&mut archive, central + 20, compressed);
            }
            "longer" | "shorter" => {
                let size = if change == "longer" {
                    CONTENT.len() + 1
                } else {
                    CONTENT.len() - 1
                } as u32;
                write_u32(&mut archive, 22, size);
                write_u32(&mut archive, central + 24, size);
            }
            _ => unreachable!(),
        }
        let fixture = Fixture::new();
        assert!(
            !fixture.extract(&archive, ONE_LIMIT),
            "accepted invalid {change}"
        );
    }
}

#[test]
fn preflights_zip64_before_loading_its_central_directory() {
    let mut archive = zip(&FILES[..1], CompressionMethod::Stored);
    let central = marker(&archive, b"PK\x01\x02");
    let end = marker(&archive, b"PK\x05\x06");
    let mut legacy = archive.split_off(end);
    legacy[8..20].fill(255);
    let mut zip64 = [0; 56];
    zip64[..4].copy_from_slice(b"PK\x06\x06");
    write_u64(&mut zip64, 4, 44);
    write_u16(&mut zip64, 12, 45);
    write_u16(&mut zip64, 14, 45);
    write_u64(&mut zip64, 24, 1);
    write_u64(&mut zip64, 32, 1);
    write_u64(&mut zip64, 40, (end - central) as u64);
    write_u64(&mut zip64, 48, central as u64);
    archive.extend(zip64);
    let mut locator = [0; 20];
    locator[..4].copy_from_slice(b"PK\x06\x07");
    write_u64(&mut locator, 8, end as u64);
    write_u32(&mut locator, 16, 1);
    archive.extend(locator);
    archive.extend(legacy);
    assert!(Fixture::new().extract(&archive, ONE_LIMIT));

    write_u64(&mut archive, end + 4, u64::MAX);
    assert!(!Fixture::new().extract(&archive, ONE_LIMIT));
}

#[test]
fn leaves_existing_files_intact_and_bounds_the_cli_input() {
    let archive = zip(&FILES[..1], CompressionMethod::Stored);
    let fixture = Fixture::new();
    let preserved = fixture.0.join("out/candidate.json");
    fs::write(&preserved, b"keep me").unwrap();
    assert!(!fixture.extract(&archive, ONE_LIMIT));
    assert_eq!(fs::read(preserved).unwrap(), b"keep me");
    for invalid_limits in [
        b"not-json".as_slice(),
        br#"{"candidate.json":0}"#,
        br#"{"NUL.json":512}"#,
        br#"{"../candidate.json":512}"#,
        br#"{"candidate.json":18446744073709551615}"#,
        &[b' '; 4097],
    ] {
        assert!(!fixture.extract(&archive, invalid_limits));
    }
    assert!(!run(&[Path::new("unknown-option")], b""));
    assert!(!run(&[Path::new("extract-candidate")], b""));
}
