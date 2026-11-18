mod http;
mod protocol;
mod validation;

use std::{error::Error, fmt};

use jsonschema::Validator;
use serde_json::Value;

pub use http::{
    HttpDescriptor, HttpMethod, HttpOperation, HttpRequest, HttpRequestOptions, HttpSocket,
};
pub use protocol::ProtocolContracts;

use validation::{
    array, matches_record, string, validate_candidate, validate_catalog, validate_manifest,
    validate_release,
};

const SCHEMA: &str = include_str!(concat!(env!("OUT_DIR"), "/contracts.schema.json"));
const RELEASE_DISTRIBUTION: &str = "https://github.com/RentnerProxy/app-catalog/releases/download/";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ContractError {
    InvalidSchema,
    InvalidShape,
    InvalidManifest,
    IncompatibleManifest,
    InvalidRelease,
    InvalidCandidate,
    InvalidCatalog,
    ApprovalMismatch,
    PublicationMismatch,
}

impl ContractError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidSchema => "invalidSchema",
            Self::InvalidShape => "invalidShape",
            Self::InvalidManifest => "invalidManifest",
            Self::IncompatibleManifest => "incompatibleManifest",
            Self::InvalidRelease => "invalidRelease",
            Self::InvalidCandidate => "invalidCandidate",
            Self::InvalidCatalog => "invalidCatalog",
            Self::ApprovalMismatch => "approvalMismatch",
            Self::PublicationMismatch => "publicationMismatch",
        }
    }
}

impl fmt::Display for ContractError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl Error for ContractError {}

fn embedded_schema() -> Result<Value, ContractError> {
    let schema: Value = serde_json::from_str(SCHEMA).map_err(|_| ContractError::InvalidSchema)?;
    let id = concat!("urn:rentnerproxy:app-contracts:", env!("CARGO_PKG_VERSION"));
    if schema["$id"] != id {
        return Err(ContractError::InvalidSchema);
    }
    Ok(schema)
}

fn compile_schema(schema: &mut Value, name: &str) -> Result<Validator, ContractError> {
    schema["$ref"] = Value::String(format!("#/$defs/{name}"));
    jsonschema::draft202012::options()
        .offline()
        .should_validate_formats(true)
        .build(schema)
        .map_err(|_| ContractError::InvalidSchema)
}

/// Offline validators for the bundled v1 contract. Callers admit bounded
/// JSON, reject duplicate members at decoding, and authenticate signed input.
pub struct Contracts {
    manifest: Validator,
    catalog: Validator,
    candidate: Validator,
    approval: Validator,
    publication: Validator,
}

impl Contracts {
    /// Compile the embedded schema once and reuse the validators.
    pub fn new() -> Result<Self, ContractError> {
        let mut schema = embedded_schema()?;
        let mut compile = |name| compile_schema(&mut schema, name);
        Ok(Self {
            manifest: compile("AppManifest")?,
            catalog: compile("Catalog")?,
            candidate: compile("Candidate")?,
            approval: compile("Approval")?,
            publication: compile("Publication")?,
        })
    }

    pub fn validate_manifest(&self, document: &Value) -> Result<(), ContractError> {
        validate_shape(&self.manifest, document)?;
        validate_manifest(document)
    }

    /// Compare a valid manifest with the capabilities of the trusted local runtime.
    pub fn check_manifest_compatibility(
        &self,
        document: &Value,
        environment: &ManifestEnvironment<'_>,
    ) -> Result<(), ContractError> {
        self.validate_manifest(document)?;
        validation::check_manifest_compatibility(document, environment)
    }

    pub fn validate_catalog<'a>(&self, document: &'a Value) -> Result<Catalog<'a>, ContractError> {
        validate_shape(&self.catalog, document)?;
        validate_catalog(document)?;
        Ok(Catalog { document })
    }

    pub fn validate_candidate(&self, document: &Value) -> Result<(), ContractError> {
        validate_shape(&self.candidate, document)?;
        validate_candidate(document)
    }

    pub fn validate_approval(&self, document: &Value) -> Result<(), ContractError> {
        validate_shape(&self.approval, document)?;
        validate_candidate(&document["candidate"])
    }

    pub fn validate_publication(&self, document: &Value) -> Result<(), ContractError> {
        validate_shape(&self.publication, document)?;
        validate_release(&document["release"])
    }

    /// Compare current protected records. The caller resolves actor authority,
    /// revocation, source provenance, and storage revisions before publishing.
    pub fn check_approval_binding(
        &self,
        candidate: &Value,
        approval: &Value,
    ) -> Result<(), ContractError> {
        self.validate_candidate(candidate)?;
        self.validate_approval(approval)?;
        if !matches_record(candidate, &approval["candidate"]) {
            return Err(ContractError::ApprovalMismatch);
        }
        Ok(())
    }

    pub fn check_publication_binding(
        &self,
        approval: &Value,
        receipt: &Value,
        catalog: &Value,
    ) -> Result<(), ContractError> {
        self.validate_approval(approval)?;
        self.validate_publication(receipt)?;
        let release = &receipt["release"];
        let catalog = self.validate_catalog(catalog)?;
        let published = catalog.release(string(&release["appId"]), string(&release["version"]));
        if receipt["approvalId"] != approval["id"]
            || !matches_record(&receipt["approvalRevision"], &approval["revision"])
            || !matches_record(&receipt["catalogRevision"], &catalog.document["revision"])
            || !matches_record(release, &approval["candidate"]["release"])
            || !published.is_some_and(|entry| matches_record(release, entry))
        {
            return Err(ContractError::PublicationMismatch);
        }
        Ok(())
    }
}

fn validate_shape(validator: &Validator, document: &Value) -> Result<(), ContractError> {
    if !validator.is_valid(document) {
        return Err(ContractError::InvalidShape);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub struct ManifestEnvironment<'a> {
    pub target: &'a str,
    pub runtime_profile: &'a str,
    pub platform_api: &'a str,
    pub app_protocol: &'a str,
    pub ui_bridge: Option<&'a str>,
    pub engine_capabilities: &'a [&'a str],
}

#[derive(Debug)]
pub struct CatalogIconTarget<'a> {
    pub path: String,
    pub sha256: &'a str,
    pub size_bytes: u64,
}

/// A structurally and semantically valid catalog. TUF trust and freshness
/// require independent verification of the underlying bytes.
#[derive(Debug)]
pub struct Catalog<'a> {
    document: &'a Value,
}

impl<'a> Catalog<'a> {
    pub fn releases(&self) -> &'a [Value] {
        array(&self.document["releases"])
    }

    pub fn revocations(&self) -> &'a [Value] {
        array(&self.document["revocations"])
    }

    pub fn release(&self, app_id: &str, version: &str) -> Option<&'a Value> {
        self.releases()
            .iter()
            .find(|entry| entry["appId"] == app_id && entry["version"] == version)
    }

    pub fn package(&self, app_id: &str, version: &str, target: &str) -> Option<Package<'a>> {
        let release = self.release(app_id, version)?;
        array(&release["packages"])
            .iter()
            .find(|entry| entry["manifest"]["target"] == target)
            .map(|document| Package { document })
    }

    pub fn icon_path(&self, app_id: &str, version: &str) -> Option<String> {
        self.icon_target(app_id, version).map(|icon| icon.path)
    }

    pub fn icon_target(&self, app_id: &str, version: &str) -> Option<CatalogIconTarget<'a>> {
        let icon = self.release(app_id, version)?.get("icon")?;
        let sha256 = string(&icon["sha256"]);
        let format = string(&icon["format"]);
        Some(CatalogIconTarget {
            path: format!("assets/{sha256}.{format}"),
            sha256,
            size_bytes: validation::integer(&icon["sizeBytes"]),
        })
    }
}

#[derive(Debug)]
pub struct DownloadAsset<'a> {
    pub url: String,
    pub sha256: &'a str,
    pub size_bytes: u64,
}

#[derive(Debug)]
pub struct PackageReleaseAssets<'a> {
    pub archive: DownloadAsset<'a>,
    pub manifest_sha256: &'a str,
    pub sbom: DownloadAsset<'a>,
    pub provenance: DownloadAsset<'a>,
}

#[derive(Debug)]
pub struct Package<'a> {
    document: &'a Value,
}

impl<'a> Package<'a> {
    pub fn manifest(&self) -> &'a Value {
        &self.document["manifest"]
    }

    pub fn archive_sha256(&self) -> &'a str {
        string(&self.document["archive"]["sha256"])
    }

    pub fn archive_size_bytes(&self) -> u64 {
        validation::integer(&self.document["archive"]["sizeBytes"])
    }

    pub fn manifest_sha256(&self) -> &'a str {
        string(&self.document["manifestSha256"])
    }

    pub fn download_url(&self) -> String {
        let manifest = self.manifest();
        let id = string(&manifest["id"]);
        let version = string(&manifest["version"]);
        let target = string(&manifest["target"]);
        format!("{RELEASE_DISTRIBUTION}{id}-v{version}/{id}-{version}-{target}.tar.zst")
    }

    /// Resolve locations and expected byte identities from a trusted catalog.
    pub fn release_assets(&self) -> PackageReleaseAssets<'a> {
        let asset = |name, url| DownloadAsset {
            url,
            sha256: string(&self.document[name]["sha256"]),
            size_bytes: validation::integer(&self.document[name]["sizeBytes"]),
        };
        let url = self.download_url();
        let sbom = asset("sbom", format!("{url}.sbom.json"));
        let provenance = asset("provenance", format!("{url}.provenance.json"));
        PackageReleaseAssets {
            archive: asset("archive", url),
            manifest_sha256: self.manifest_sha256(),
            sbom,
            provenance,
        }
    }
}
