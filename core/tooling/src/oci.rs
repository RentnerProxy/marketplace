use crate::security::{files, invalid, lower_hex, string};
use marketplace_artifacts::{file_identity, parse_json};
use serde_json::{Value, json};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

mod archive;
mod evidence;

const ARCHIVE: &str = "candidate-image.tar";
const CANDIDATE: &str = "candidate.json";

fn directory(input: &Value) -> io::Result<PathBuf> {
    let root = Path::new(string(input, "temporary")?);
    let supplied = Path::new(string(input, "directory")?);
    let relative = Path::new("marketplace-dev-candidate");
    let expected = root.join(relative);
    if !root.is_absolute() || !supplied.is_absolute() || supplied != expected {
        return Err(invalid(
            "Candidate directory must be the owned runner temporary directory",
        ));
    }
    files::no_links(root, relative)?;
    if !fs::symlink_metadata(&expected)?.is_dir() {
        return Err(invalid(
            "Candidate directory must be the owned runner temporary directory",
        ));
    }
    Ok(expected)
}

fn require_archive_hash(path: &Path, expected: &str, error: &str) -> io::Result<()> {
    if !lower_hex(expected, 64) || file_identity(path, archive::MAX_ARCHIVE)?.sha256 != expected {
        return Err(invalid(error));
    }
    Ok(())
}

fn handoff_bytes(input: &Value, directory: &Path) -> io::Result<Vec<u8>> {
    let bytes = files::read(&directory.join(CANDIDATE), archive::MAX_JSON)?;
    let expected = string(input, "expectedEvidenceSha256")?;
    if !lower_hex(expected, 64) || marketplace_artifacts::digest(&bytes) != expected {
        return Err(invalid("Assessed candidate artifact hash mismatch"));
    }
    Ok(bytes)
}

fn read_image(input: &Value, directory: &Path) -> io::Result<Value> {
    let actual = archive::read(&directory.join(ARCHIVE))?;
    if let Some(id) = input.get("imageId")
        && id != &actual["imageId"]
    {
        return Err(invalid("Dev image OCI config digest mismatch"));
    }
    Ok(actual)
}

fn verified(input: &Value, identity: &Value, directory: &Path) -> io::Result<Value> {
    let receipt = parse_json(&handoff_bytes(input, directory)?)?;
    let actual = read_image(input, directory)?;
    if actual["archiveSha256"] != input["expectedArchiveSha256"] {
        return Err(invalid("Assessed candidate artifact hash mismatch"));
    }
    let candidate = evidence::validate_candidate(&receipt, identity, &actual)?;
    if candidate["digest"] != input["expectedDigest"] {
        return Err(invalid("Assessed candidate manifest digest mismatch"));
    }
    Ok(candidate)
}

fn ready(input: &Value, identity: &Value, directory: &Path) -> io::Result<Value> {
    let candidate = verified(input, identity, directory)?;
    let assessment = files::json(&directory.join("assessment.json"), archive::MAX_JSON)?;
    if !assessment["assessedAt"].is_string() {
        return Err(invalid("Missing successful publisher assessment"));
    }
    if assessment != evidence::assessment(&candidate, &assessment["assessedAt"])? {
        return Err(invalid("Publisher assessment does not match the candidate"));
    }
    Ok(candidate)
}

fn save_evidence(directory: &Path, name: &str, evidence: &Value) -> io::Result<String> {
    let mut bytes = serde_json::to_vec_pretty(evidence)?;
    bytes.push(b'\n');
    let mut temporary = NamedTempFile::new_in(directory)?;
    temporary.write_all(&bytes)?;
    temporary.flush()?;
    temporary
        .persist(directory.join(name))
        .map_err(|error| error.error)?;
    Ok(marketplace_artifacts::digest(&bytes))
}

fn run_dev(operation: &str, input: &Value) -> io::Result<Value> {
    let identity = evidence::identity(&input["context"])?;
    if operation == "prepare" {
        return Ok(json!({
            "revision": identity["revision"],
            "image": identity["image"],
            "version": identity["version"],
            "immutable_tag": identity["immutableTag"],
        }));
    }
    let directory = directory(input)?;
    match operation {
        "preflight" => {
            let actual = read_image(input, &directory)?;
            evidence::candidate(&identity, &actual)?;
            Ok(actual["archiveSha256"].clone())
        }
        "loaded" => {
            let actual = read_image(input, &directory)?;
            if actual["archiveSha256"] != input["preflightArchiveSha256"] {
                return Err(invalid("Dev image archive changed after preflight"));
            }
            let candidate = evidence::candidate(&identity, &actual)?;
            let inspected =
                files::json(&directory.join("runtime-inspect.json"), archive::MAX_JSON)?;
            let inspected = match inspected.as_array().map(Vec::as_slice) {
                Some([image]) => image,
                _ => return Err(invalid("Expected exactly one imported runtime image")),
            };
            Ok(json!({
                "runtime_image_id": evidence::loaded_image(&actual["config"], inspected)?,
                "image_id": candidate["imageId"],
                "archive_sha256": candidate["archiveSha256"],
            }))
        }
        "seal" => {
            let tested = string(input, "testedArchiveSha256")?;
            let actual = match read_image(input, &directory) {
                Ok(actual) => actual,
                Err(error) => {
                    require_archive_hash(
                        &directory.join(ARCHIVE),
                        tested,
                        "Candidate archive changed after runtime verification",
                    )?;
                    return Err(error);
                }
            };
            if actual["archiveSha256"] != tested {
                return Err(invalid(
                    "Candidate archive changed after runtime verification",
                ));
            }
            let candidate = evidence::candidate(&identity, &actual)?;
            let evidence_hash = save_evidence(&directory, CANDIDATE, &candidate)?;
            Ok(json!({
                "digest": candidate["digest"],
                "archive_sha256": candidate["archiveSha256"],
                "evidence_sha256": evidence_hash,
            }))
        }
        "hashes" => {
            handoff_bytes(input, &directory)?;
            require_archive_hash(
                &directory.join(ARCHIVE),
                string(input, "expectedArchiveSha256")?,
                "Assessed candidate artifact hash mismatch",
            )?;
            Ok(Value::Null)
        }
        "verify" => {
            let candidate = verified(input, &identity, &directory)?;
            let mut selected = identity;
            selected["digest"] = candidate["digest"].clone();
            selected["imageConfigDigest"] = candidate["imageId"].clone();
            save_evidence(&directory, "identity.json", &selected)?;
            Ok(Value::Null)
        }
        "assess" => {
            let candidate = verified(input, &identity, &directory)?;
            let assessment = evidence::assessment(&candidate, &input["timestamp"])?;
            save_evidence(&directory, "assessment.json", &assessment)?;
            Ok(Value::Null)
        }
        "ready" => Ok(ready(input, &identity, &directory)?["immutableTag"].clone()),
        "published" => {
            let candidate = ready(input, &identity, &directory)?;
            let publication =
                evidence::publication(&candidate, &input["remote"], &input["timestamp"])?;
            save_evidence(&directory, "publication.json", &publication)?;
            Ok(Value::Null)
        }
        _ => Err(invalid("Unknown Dev image command")),
    }
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation.strip_prefix("oci-").unwrap_or(operation) {
        "identity" => evidence::identity(&input),
        "candidate-evidence" => evidence::candidate(&input["identity"], &input["actual"]),
        "verify-candidate-evidence" => {
            evidence::validate_candidate(&input["candidate"], &input["identity"], &input["actual"])
        }
        "loaded-evidence" => Ok(json!(evidence::loaded_image(
            &input["config"],
            &input["inspected"]
        )?)),
        "assessment-evidence" => evidence::assessment(&input["candidate"], &input["timestamp"]),
        "publication-evidence" => {
            evidence::publication(&input["candidate"], &input["remote"], &input["timestamp"])
        }
        "hash-scan-archive" => {
            let expected = string(&input, "expected")?;
            if !lower_hex(expected, 64) {
                return Err(invalid("Invalid scan archive hash"));
            }
            require_archive_hash(
                Path::new(string(&input, "path")?),
                expected,
                "Scan archive hash mismatch",
            )?;
            Ok(Value::Null)
        }
        "compare-scan-manifests" => {
            let first = files::read(Path::new(string(&input, "first")?), archive::MAX_JSON)?;
            let second = files::read(Path::new(string(&input, "second")?), archive::MAX_JSON)?;
            if first.is_empty() || first != second {
                return Err(invalid(
                    "Copied OCI scan layout does not preserve the source manifest",
                ));
            }
            Ok(Value::Null)
        }
        "registry-digest" => {
            let expected = evidence::digest(&input["expected"])?;
            let actual = format!(
                "sha256:{}",
                file_identity(Path::new(string(&input, "path")?), archive::MAX_JSON)?.sha256
            );
            if actual != expected {
                return Err(invalid(
                    "Dev registry tag digest mismatch; refusing overwrite or approval",
                ));
            }
            Ok(json!(actual))
        }
        "registry-main" => {
            let revision = string(&input, "revision")?;
            if !lower_hex(revision, 40) || input["currentMain"] != revision {
                return Err(invalid("main advanced; dispatch a new Dev Image run."));
            }
            Ok(Value::Null)
        }
        "dev" => run_dev(string(&input, "command")?, &input),
        _ => Err(invalid("Unknown OCI operation")),
    }
}
