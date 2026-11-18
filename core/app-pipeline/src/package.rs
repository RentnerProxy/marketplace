mod compression;
mod documents;
mod elf;
mod promotion;
mod references;
mod ustar;

use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use marketplace_artifacts::{digest, invalid, open_regular};
use rentnerproxy_app_contracts::{ContractError, Contracts, ManifestEnvironment};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

const ARCHIVE_LIMIT: u64 = 256 * 1024 * 1024;
const COMPRESSED_LIMIT: u64 = 257 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ValidateRequest {
    archive_path: PathBuf,
    output_directory: PathBuf,
    source: Source,
    target: elf::Target,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    repository_id: String,
    commit: String,
}

#[derive(Deserialize, Serialize)]
struct ExecutableLinkage {
    path: String,
    #[serde(flatten)]
    abi: elf::Linkage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerifyAbiRequest {
    linkage: Vec<ExecutableLinkage>,
    appliance_library_versions: elf::LibraryVersions,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PromoteRequest {
    staging_path: PathBuf,
    output_directory: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectElfRequest {
    input_path: PathBuf,
    target: elf::Target,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectApplianceLibraryRequest {
    input_path: PathBuf,
    library: String,
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation {
        "validate-package" => validate(request(input)?),
        "verify-package-abi" => verify_abi(request(input)?),
        "promote-package" => {
            let request: PromoteRequest = request(input)?;
            promotion::promote(&request.staging_path, &request.output_directory)?;
            Ok(Value::Null)
        }
        "inspect-elf" => {
            let request: InspectElfRequest = request(input)?;
            let (file, _) = open_regular(&request.input_path, ustar::EXECUTABLE_LIMIT)?;
            Ok(serde_json::to_value(elf::inspect(file, request.target)?)?)
        }
        "inspect-appliance-library" => {
            let request: InspectApplianceLibraryRequest = request(input)?;
            let definitions = elf::appliance_library(&request.input_path, &request.library)?;
            Ok(serde_json::to_value(definitions)?)
        }
        "compress-package" => compression::compress(request(input)?),
        "decompress-package" => compression::decompress(request(input)?),
        _ => Err(invalid("Unknown native app pipeline operation")),
    }
}

fn request<T: DeserializeOwned>(input: Value) -> io::Result<T> {
    serde_json::from_value(input).map_err(|_| invalid("Invalid native package request"))
}

fn validate(request: ValidateRequest) -> io::Result<Value> {
    let destination = promotion::fresh_destination(&request.output_directory)?;
    let mut builder = tempfile::Builder::new();
    builder.prefix(".candidate-package-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o700));
    }
    let staging = builder.tempdir_in(promotion::parent(&destination))?;
    let (input, before) = open_regular(&request.archive_path, ARCHIVE_LIMIT)?;
    let entries = ustar::extract(&input, &before, staging.path())?;

    let files = documents::Files::new(staging.path(), &entries);
    let raw_manifest = files.read("app.json")?;
    let manifest = documents::decode_json(&raw_manifest, "app.json")?;
    manifest_compatibility(&manifest, &request.source, request.target)?;
    documents::validate(&files, &manifest)?;
    let linkage = verify_binaries(staging.path(), &entries, request.target)?;

    ustar::set_root_permissions(staging.path())?;
    promotion::promote(staging.path(), &destination)?;
    let _ = staging.keep();
    Ok(json!({"manifest": manifest, "manifestSha256": digest(&raw_manifest), "linkage": linkage}))
}

fn manifest_compatibility(
    manifest: &Value,
    source: &Source,
    target: elf::Target,
) -> io::Result<()> {
    let environment = ManifestEnvironment {
        target: target.name(),
        runtime_profile: "rentnerproxy-linux-v1",
        platform_api: "1.0.0",
        app_protocol: "1.0.0",
        ui_bridge: Some("1.0.0"),
        engine_capabilities: &["caddy.load-balancing.v1", "caddy.crowdsec.v1"],
    };
    Contracts::new()
        .and_then(|contracts| contracts.check_manifest_compatibility(manifest, &environment))
        .map_err(|error| match error {
            ContractError::IncompatibleManifest => {
                invalid("Candidate runtime does not satisfy the manifest requirements")
            }
            _ => invalid("Candidate manifest violates the app contract"),
        })?;
    if manifest["source"]["repositoryId"] != source.repository_id
        || manifest["source"]["commit"] != source.commit
    {
        return Err(invalid(
            "Candidate package source identity does not match its exact checkout",
        ));
    }
    Ok(())
}

fn verify_binaries(
    staging: &Path,
    entries: &[ustar::Entry],
    target: elf::Target,
) -> io::Result<Vec<ExecutableLinkage>> {
    let mut linkage = Vec::new();
    let executables = entries
        .iter()
        .filter(|entry| !entry.directory && entry.executable);
    for (index, entry) in executables.enumerate() {
        if index >= 16 {
            return Err(invalid("Candidate package has too many executables"));
        }
        let path = staging.join(&entry.path);
        if let Some(abi) = elf::inspect(File::open(&path)?, target)? {
            abi.verify_readelf(&path)?;
            linkage.push(ExecutableLinkage {
                path: entry.path.clone(),
                abi,
            });
        }
    }
    Ok(linkage)
}

fn verify_abi(request: VerifyAbiRequest) -> io::Result<Value> {
    if request.linkage.len() > 16 {
        return Err(invalid("Candidate package has too many executables"));
    }
    for executable in request.linkage {
        executable
            .abi
            .verify_appliance(&request.appliance_library_versions)?;
    }
    Ok(Value::Null)
}
