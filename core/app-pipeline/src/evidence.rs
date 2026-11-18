mod documents;
mod files;
pub(crate) mod order;

use std::{
    io,
    path::{Path, PathBuf},
    sync::LazyLock,
};

use documents::{
    Assembled, BuildIdentity, Expectation, Package, Purpose, SourceIdentity, TARGETS, TargetRecord,
    ValidationReport, assemble, github_id, report_identity, sha,
};
use files::{
    assert_directory, check_directory, copy_asset, file_identity, identity, json_bytes,
    prepare_output, read_bytes, save_metadata,
};
use marketplace_artifacts::{FileIdentity, invalid, parse_json};
use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::sbom::{self, SIZE_LIMIT as SBOM_LIMIT};

const METADATA_LIMIT: u64 = 512 * 1024;
// zstd's small worst-case overhead on a 256 MiB admitted tar.
const PACKAGE_LIMIT: u64 = 257 * 1024 * 1024;
pub const BUNDLE_LIMIT: u64 = 2 * (PACKAGE_LIMIT + SBOM_LIMIT + METADATA_LIMIT) + 4 * 1024 * 1024;
const TARGET_NAME: &str = "target.json";
const CANDIDATE_NAME: &str = "candidate.json";
const REPORT_NAME: &str = "validation-report.json";
static ARTIFACT_TIMESTAMP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-5][0-9]\.[0-9]{3}Z$").unwrap()
});

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SealTargetInput {
    output_directory: PathBuf,
    archive_path: PathBuf,
    sbom_path: PathBuf,
    manifest: Value,
    manifest_sha256: String,
    build: BuildIdentity,
    purpose: Purpose,
    appliance_image: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SealCandidateInput {
    output_directory: PathBuf,
    target_directories: TargetDirectories,
    publisher_name: String,
    source: SourceIdentity,
    build: BuildIdentity,
    purpose: Purpose,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TargetDirectories {
    #[serde(rename = "linux-amd64")]
    amd64: PathBuf,
    #[serde(rename = "linux-arm64")]
    arm64: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssembleInput {
    records: [TargetRecord; 2],
    publisher_name: String,
    source: SourceIdentity,
    build: BuildIdentity,
    purpose: Purpose,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerifyHandoffInput {
    directory: PathBuf,
    source: SourceIdentity,
    build: BuildIdentity,
    artifact: ArtifactReceipt,
    downloaded_artifact: DownloadedArtifact,
    now: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArtifactReceipt {
    id: String,
    sha256: String,
    expires_at: String,
    expired: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DownloadedArtifact {
    id: String,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileInput {
    path: PathBuf,
    limit: u64,
    expected: Option<FileIdentity>,
}

struct Asset<'a> {
    name: String,
    identity: &'a FileIdentity,
    limit: u64,
}

fn assets_for(package: &Package) -> [Asset<'_>; 3] {
    let name = package.archive_name();
    [
        Asset {
            name: name.clone(),
            identity: &package.archive,
            limit: PACKAGE_LIMIT,
        },
        Asset {
            name: format!("{name}.sbom.json"),
            identity: &package.sbom,
            limit: SBOM_LIMIT,
        },
        Asset {
            name: format!("{name}.provenance.json"),
            identity: &package.provenance,
            limit: METADATA_LIMIT,
        },
    ]
}

fn candidate_names(records: &[TargetRecord; 2]) -> Vec<String> {
    [CANDIDATE_NAME.to_owned(), REPORT_NAME.to_owned()]
        .into_iter()
        .chain(
            records
                .iter()
                .flat_map(|record| assets_for(&record.package).map(|asset| asset.name)),
        )
        .collect()
}

fn parse(bytes: &[u8]) -> io::Result<Value> {
    parse_json(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes))
}

fn verify_assets(directory: &Path, record: &TargetRecord) -> io::Result<()> {
    let [archive, sbom, provenance] = assets_for(&record.package);
    file_identity(
        &directory.join(archive.name),
        archive.limit,
        Some(archive.identity),
    )?;
    sbom::verify_bytes(&read_bytes(
        &directory.join(sbom.name),
        sbom.limit,
        Some(sbom.identity),
    )?)?;
    let bytes = read_bytes(
        &directory.join(provenance.name),
        provenance.limit,
        Some(provenance.identity),
    )?;
    if bytes != record.provenance_bytes()? {
        return Err(invalid(
            "Candidate provenance does not match target evidence",
        ));
    }
    Ok(())
}

fn seal_target(input: SealTargetInput) -> io::Result<Value> {
    let archive = file_identity(&input.archive_path, PACKAGE_LIMIT, None)?;
    let sbom = read_bytes(&input.sbom_path, SBOM_LIMIT, None)?;
    sbom::verify_bytes(&sbom)?;
    let package = Package {
        manifest: input.manifest,
        archive,
        manifest_sha256: input.manifest_sha256,
        sbom: identity(&sbom),
        provenance: identity(&[]),
    };
    let record = TargetRecord::new(input.build, input.purpose, input.appliance_image, package)?;
    let output = &input.output_directory;
    let [archive, sbom, provenance] = assets_for(&record.package);
    let names = vec![
        TARGET_NAME.to_owned(),
        archive.name.clone(),
        sbom.name.clone(),
        provenance.name.clone(),
    ];
    prepare_output(output, &names)?;
    copy_asset(
        &input.archive_path,
        &output.join(archive.name),
        archive.limit,
        archive.identity,
    )?;
    copy_asset(
        &input.sbom_path,
        &output.join(sbom.name),
        sbom.limit,
        sbom.identity,
    )?;
    save_metadata(output, &provenance.name, &record.provenance_bytes()?)?;
    save_metadata(output, TARGET_NAME, &json_bytes(&record)?)?;
    check_directory(output, &names, false)?;
    Ok(serde_json::to_value(record)?)
}

fn load_target(
    directory: &Path,
    expectation: &Expectation,
    target: &str,
) -> io::Result<TargetRecord> {
    assert_directory(directory)?;
    let bytes = read_bytes(&directory.join(TARGET_NAME), METADATA_LIMIT, None)?;
    let record: TargetRecord = serde_json::from_value(parse(&bytes)?)?;
    record.validate()?;
    record.assert_target(expectation, target)?;
    if bytes != json_bytes(&record)? {
        return Err(invalid(
            "Candidate target record differs from its canonical seal",
        ));
    }
    let mut names = vec![TARGET_NAME.to_owned()];
    names.extend(assets_for(&record.package).map(|asset| asset.name));
    check_directory(directory, &names, false)?;
    Ok(record)
}

fn seal_candidate(input: SealCandidateInput) -> io::Result<Value> {
    let expectation = Expectation {
        source: input.source,
        build: input.build,
        purpose: input.purpose,
    };
    expectation.validate()?;
    let directories = [
        &input.target_directories.amd64,
        &input.target_directories.arm64,
    ];
    let records = [
        load_target(directories[0], &expectation, TARGETS[0])?,
        load_target(directories[1], &expectation, TARGETS[1])?,
    ];
    let Assembled {
        sealed,
        candidate_bytes,
        report_bytes,
    } = assemble(&records, &expectation, &input.publisher_name)?;
    for (directory, record) in directories.into_iter().zip(&records) {
        verify_assets(directory, record)?;
    }
    let output = &input.output_directory;
    let names = candidate_names(&records);
    prepare_output(output, &names)?;
    for (directory, record) in directories.into_iter().zip(&records) {
        for asset in assets_for(&record.package) {
            copy_asset(
                &directory.join(&asset.name),
                &output.join(&asset.name),
                asset.limit,
                asset.identity,
            )?;
        }
    }
    save_metadata(output, REPORT_NAME, &report_bytes)?;
    save_metadata(output, CANDIDATE_NAME, &candidate_bytes)?;
    check_directory(output, &names, false)?;
    Ok(sealed)
}

fn verify_receipt(
    receipt: &ArtifactReceipt,
    download: &DownloadedArtifact,
    now: i64,
) -> io::Result<()> {
    let expiration = ARTIFACT_TIMESTAMP
        .is_match(&receipt.expires_at)
        .then(|| OffsetDateTime::parse(&receipt.expires_at, &Rfc3339).ok())
        .flatten();
    if !github_id(&receipt.id)
        || !sha(&receipt.sha256, 64)
        || expiration
            .is_none_or(|expires| expires.unix_timestamp_nanos() <= i128::from(now) * 1_000_000)
        || !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&now)
        || receipt.expired
        || receipt.id != download.id
        || receipt.sha256 != download.sha256
    {
        return Err(invalid(
            "Candidate artifact receipt is expired or differs from the download",
        ));
    }
    Ok(())
}

fn verify_handoff(input: VerifyHandoffInput) -> io::Result<Value> {
    verify_receipt(&input.artifact, &input.downloaded_artifact, input.now)?;
    let expectation = Expectation {
        source: input.source,
        build: input.build,
        purpose: Purpose::Candidate,
    };
    expectation.validate()?;
    let directory = &input.directory;
    assert_directory(directory)?;
    let candidate_bytes = read_bytes(&directory.join(CANDIDATE_NAME), METADATA_LIMIT, None)?;
    let candidate = parse(&candidate_bytes)?;
    let report = report_identity(&candidate)?;
    let report_bytes = read_bytes(&directory.join(REPORT_NAME), METADATA_LIMIT, Some(&report))?;
    let report: ValidationReport = serde_json::from_value(parse(&report_bytes)?)?;
    let publisher = candidate["release"]["publisher"]["name"]
        .as_str()
        .ok_or_else(|| invalid("Invalid Candidate publisher"))?;
    let sealed = assemble(&report.targets, &expectation, publisher)?;
    if candidate_bytes != sealed.candidate_bytes || report_bytes != sealed.report_bytes {
        return Err(invalid("Candidate handoff differs from its canonical seal"));
    }
    check_directory(directory, &candidate_names(&report.targets), false)?;
    for record in &report.targets {
        verify_assets(directory, record)?;
    }
    Ok(sealed.sealed)
}

fn assemble_input(input: AssembleInput) -> io::Result<Value> {
    let expectation = Expectation {
        source: input.source,
        build: input.build,
        purpose: input.purpose,
    };
    let Assembled {
        sealed,
        report_bytes,
        ..
    } = assemble(&input.records, &expectation, &input.publisher_name)?;
    Ok(
        json!({"sealed": sealed, "reportBytes": String::from_utf8(report_bytes).map_err(io::Error::other)?}),
    )
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation {
        "seal-target" => seal_target(serde_json::from_value(input)?),
        "seal-candidate" => seal_candidate(serde_json::from_value(input)?),
        "verify-handoff" => verify_handoff(serde_json::from_value(input)?),
        "assemble" => assemble_input(serde_json::from_value(input)?),
        "file-identity" => {
            let input: FileInput = serde_json::from_value(input)?;
            if input.limit > PACKAGE_LIMIT {
                return Err(invalid("Candidate evidence file limit is too large"));
            }
            let identity = file_identity(&input.path, input.limit, input.expected.as_ref())?;
            Ok(serde_json::to_value(identity)?)
        }
        "read-json" => {
            let input: FileInput = serde_json::from_value(input)?;
            if input.limit > SBOM_LIMIT {
                return Err(invalid("Candidate metadata file limit is too large"));
            }
            let bytes = read_bytes(&input.path, input.limit, input.expected.as_ref())?;
            Ok(
                json!({"value": parse(&bytes)?, "bytes": String::from_utf8(bytes).map_err(io::Error::other)?}),
            )
        }
        _ => Err(invalid("Unknown candidate evidence operation")),
    }
}
