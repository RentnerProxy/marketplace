use std::{io, sync::LazyLock};

use marketplace_artifacts::FileIdentity;
use regex::Regex;
use rentnerproxy_app_contracts::{ContractError, Contracts};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    REPORT_NAME,
    files::{identity, json_bytes},
    invalid,
    order::serialize_manifest,
};

static CONTRACTS: LazyLock<Result<Contracts, ContractError>> = LazyLock::new(Contracts::new);
static WORKFLOW_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\.github/workflows/[a-zA-Z0-9_-]+\.ya?ml$").unwrap());
static APPLIANCE_IMAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9._/:+-]*@sha256:[0-9a-f]{64}$").unwrap());
const SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(super) fn contracts() -> io::Result<&'static Contracts> {
    CONTRACTS.as_ref().map_err(|error| io::Error::other(*error))
}

pub(super) fn sha(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn github_id(value: &str) -> bool {
    (1..=20).contains(&value.len())
        && !value.starts_with('0')
        && value.bytes().all(|byte| byte.is_ascii_digit())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BuildIdentity {
    repository_id: String,
    workflow_commit: String,
    workflow_path: String,
    run_id: String,
    attempt: u64,
}

impl BuildIdentity {
    fn validate(&self) -> io::Result<()> {
        if !github_id(&self.repository_id)
            || !sha(&self.workflow_commit, 40)
            || self.workflow_path.len() > 160
            || !WORKFLOW_PATH.is_match(&self.workflow_path)
            || !github_id(&self.run_id)
            || !(1..=SAFE_INTEGER).contains(&self.attempt)
        {
            return Err(invalid("Invalid candidate build identity"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SourceIdentity {
    repository_id: String,
    commit: String,
}

impl SourceIdentity {
    fn validate(&self) -> io::Result<()> {
        if !github_id(&self.repository_id) || !sha(&self.commit, 40) {
            return Err(invalid("Invalid candidate source identity"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Purpose {
    Candidate,
    Reference,
    Development,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Passed {
    Passed,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PassedChecks {
    package: Passed,
    security_scan: Passed,
    appliance_smoke: Passed,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Package {
    #[serde(serialize_with = "serialize_manifest")]
    pub(super) manifest: Value,
    pub(super) archive: FileIdentity,
    pub(super) manifest_sha256: String,
    pub(super) sbom: FileIdentity,
    pub(super) provenance: FileIdentity,
}

impl Package {
    fn validate(&self) -> io::Result<()> {
        contracts()?
            .validate_manifest(&self.manifest)
            .map_err(io::Error::other)?;
        if !sha(&self.manifest_sha256, 64)
            || !valid_identity(&self.archive, 2_147_483_647)
            || !valid_identity(&self.sbom, 16_777_216)
            || !valid_identity(&self.provenance, 16_777_216)
        {
            return Err(invalid("Invalid candidate package identity"));
        }
        Ok(())
    }

    pub(super) fn archive_name(&self) -> String {
        format!(
            "{}-{}-{}.tar.zst",
            self.field("id"),
            self.field("version"),
            self.field("target")
        )
    }

    fn field(&self, name: &str) -> &str {
        self.manifest[name]
            .as_str()
            .expect("validated manifest string")
    }

    fn source(&self) -> io::Result<SourceIdentity> {
        Ok(serde_json::from_value(self.manifest["source"].clone())?)
    }
}

fn valid_identity(identity: &FileIdentity, max_bytes: u64) -> bool {
    sha(&identity.sha256, 64) && (1..=max_bytes).contains(&identity.size_bytes)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct TargetRecord {
    format_version: u32,
    build: BuildIdentity,
    purpose: Purpose,
    appliance_image: String,
    checks: PassedChecks,
    pub(super) package: Package,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Provenance<'a> {
    format_version: u32,
    build: &'a BuildIdentity,
    purpose: Purpose,
    appliance_image: &'a str,
    checks: PassedChecks,
    app_id: &'a str,
    version: &'a str,
    target: &'a str,
    source: SourceIdentity,
    manifest_sha256: &'a str,
    archive: &'a FileIdentity,
    sbom: &'a FileIdentity,
}

pub(super) struct Expectation {
    pub(super) source: SourceIdentity,
    pub(super) build: BuildIdentity,
    pub(super) purpose: Purpose,
}

impl Expectation {
    pub(super) fn validate(&self) -> io::Result<()> {
        self.source.validate()?;
        self.build.validate()
    }
}

impl TargetRecord {
    pub(super) fn new(
        build: BuildIdentity,
        purpose: Purpose,
        appliance_image: String,
        package: Package,
    ) -> io::Result<Self> {
        let mut record = Self {
            format_version: 1,
            build,
            purpose,
            appliance_image,
            checks: PassedChecks {
                package: Passed::Passed,
                security_scan: Passed::Passed,
                appliance_smoke: Passed::Passed,
            },
            package,
        };
        // Validate the manifest before constructing a provenance record from its fields.
        contracts()?
            .validate_manifest(&record.package.manifest)
            .map_err(io::Error::other)?;
        record.package.provenance = identity(&record.provenance_bytes()?);
        record.validate()?;
        Ok(record)
    }

    pub(super) fn validate(&self) -> io::Result<()> {
        self.build.validate()?;
        self.package.validate()?;
        if self.format_version != 1
            || self.appliance_image.len() > 512
            || !APPLIANCE_IMAGE.is_match(&self.appliance_image)
        {
            return Err(invalid("Invalid candidate target context"));
        }
        if self.purpose == Purpose::Candidate
            && self.package.field("id") == "rentnerproxy.candidate-reference"
        {
            return Err(invalid(
                "Reference packages must retain their non-publication purpose",
            ));
        }
        Ok(())
    }

    pub(super) fn provenance_bytes(&self) -> io::Result<Vec<u8>> {
        let package = &self.package;
        json_bytes(&Provenance {
            format_version: self.format_version,
            build: &self.build,
            purpose: self.purpose,
            appliance_image: &self.appliance_image,
            checks: self.checks,
            app_id: package.field("id"),
            version: package.field("version"),
            target: package.field("target"),
            source: package.source()?,
            manifest_sha256: &package.manifest_sha256,
            archive: &package.archive,
            sbom: &package.sbom,
        })
    }

    pub(super) fn assert_target(&self, expectation: &Expectation, target: &str) -> io::Result<()> {
        if self.package.field("target") != target
            || self.package.source()? != expectation.source
            || self.build != expectation.build
            || self.purpose != expectation.purpose
        {
            return Err(invalid(
                "Candidate target source, build, purpose, or platform mismatch",
            ));
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ValidationReport {
    format_version: u32,
    result: Passed,
    pub(super) targets: [TargetRecord; 2],
}

#[derive(Serialize)]
struct Evidence {
    revision: u32,
    report: FileIdentity,
    result: Passed,
}

#[derive(Serialize)]
struct Publisher<'a> {
    namespace: &'a str,
    name: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Release<'a> {
    app_id: &'a str,
    version: &'a str,
    source: &'a SourceIdentity,
    publisher: Publisher<'a>,
    packages: [&'a Package; 2],
}

#[derive(Serialize)]
struct CandidateBody<'a> {
    source: &'a SourceIdentity,
    build: &'a BuildIdentity,
    evidence: Evidence,
    release: Release<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidate<'a> {
    format_version: u32,
    id: String,
    revision: u32,
    #[serde(flatten)]
    body: CandidateBody<'a>,
}

pub(super) const TARGETS: [&str; 2] = ["linux-amd64", "linux-arm64"];

pub(super) struct Assembled {
    pub(super) sealed: Value,
    pub(super) candidate_bytes: Vec<u8>,
    pub(super) report_bytes: Vec<u8>,
}

pub(super) fn assemble(
    records: &[TargetRecord; 2],
    expectation: &Expectation,
    publisher: &str,
) -> io::Result<Assembled> {
    expectation.validate()?;
    for (record, target) in records.iter().zip(TARGETS) {
        record.validate()?;
        record.assert_target(expectation, target)?;
    }
    let [first, second] = records;
    if first.appliance_image != second.appliance_image {
        return Err(invalid(
            "Candidate targets used different appliance image references",
        ));
    }
    let report_bytes = json_bytes(&ValidationReport {
        format_version: 1,
        result: Passed::Passed,
        targets: records.clone(),
    })?;
    let app_id = first.package.field("id");
    let namespace = app_id
        .split_once('.')
        .ok_or_else(|| invalid("Invalid app ID"))?
        .0;
    let body = CandidateBody {
        source: &expectation.source,
        build: &expectation.build,
        evidence: Evidence {
            revision: 1,
            report: identity(&report_bytes),
            result: Passed::Passed,
        },
        release: Release {
            app_id,
            version: first.package.field("version"),
            source: &expectation.source,
            publisher: Publisher {
                namespace,
                name: publisher,
            },
            packages: [&first.package, &second.package],
        },
    };
    let id = identity(&json_bytes(&body)?).sha256;
    let candidate = Candidate {
        format_version: 1,
        id,
        revision: 1,
        body,
    };
    let candidate_bytes = json_bytes(&candidate)?;
    let sealed = serde_json::from_slice(&candidate_bytes)?;
    contracts()?
        .validate_candidate(&sealed)
        .map_err(io::Error::other)?;
    Ok(Assembled {
        sealed,
        candidate_bytes,
        report_bytes,
    })
}

pub(super) fn report_identity(candidate: &Value) -> io::Result<FileIdentity> {
    contracts()?
        .validate_candidate(candidate)
        .map_err(io::Error::other)?;
    serde_json::from_value(candidate["evidence"]["report"].clone()).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Invalid {REPORT_NAME} identity: {error}"),
        )
    })
}
