use crate::security::{invalid, lower_hex, sha256_digest};
use serde_json::{Value, json};
use std::io;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

const REPOSITORY: &str = "RentnerProxy/marketplace";
const IMAGE: &str = "ghcr.io/rentnerproxy/marketplace";
const WORKFLOW: &str = ".github/workflows/dev-image.yml@refs/heads/main";
const POLICY: &str = "marketplace-dev-v1";
pub(super) const MANIFEST_TYPE: &str = "application/vnd.oci.image.manifest.v1+json";

fn record(value: &Value) -> io::Result<&serde_json::Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| invalid("Invalid Dev image evidence object"))
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

fn positive_decimal(value: &str) -> bool {
    !value.is_empty() && !value.starts_with('0') && value.bytes().all(|byte| byte.is_ascii_digit())
}

pub(super) fn identity(context: &Value) -> io::Result<Value> {
    let revision = text(&context["revision"]);
    let workflow = text(&context["workflowRef"]);
    let repository = workflow
        .strip_suffix(WORKFLOW)
        .and_then(|value| value.strip_suffix('/'));
    let run_id = text(&context["runId"]);
    let run_attempt = text(&context["runAttempt"]);
    if !text(&context["repository"]).eq_ignore_ascii_case(REPOSITORY)
        || context["eventName"] != "workflow_dispatch"
        || context["ref"] != "refs/heads/main"
        || !lower_hex(revision, 40)
        || context["workflowSha"] != revision
        || !repository.is_some_and(|value| value.eq_ignore_ascii_case(REPOSITORY))
        || !positive_decimal(run_id)
        || !positive_decimal(run_attempt)
    {
        return Err(invalid(
            "Dev images require the Marketplace manual main workflow",
        ));
    }
    let version = format!("dev-{}", &revision[..12]);
    Ok(json!({
        "repository": REPOSITORY,
        "image": IMAGE,
        "revision": revision,
        "version": version,
        "immutableTag": format!("{version}-{run_id}-{run_attempt}"),
        "platforms": ["linux/amd64"],
        "runId": run_id,
        "runAttempt": run_attempt,
    }))
}

fn canonical_identity(value: &Value) -> io::Result<Value> {
    let expected = identity(&json!({
        "repository": value["repository"],
        "eventName": "workflow_dispatch",
        "ref": "refs/heads/main",
        "revision": value["revision"],
        "workflowSha": value["revision"],
        "workflowRef": format!("{REPOSITORY}/{WORKFLOW}"),
        "runId": value["runId"],
        "runAttempt": value["runAttempt"],
    }))?;
    if value != &expected {
        return Err(invalid("Invalid Dev image identity"));
    }
    Ok(expected)
}

pub(super) fn digest(value: &Value) -> io::Result<&str> {
    value
        .as_str()
        .filter(|value| sha256_digest(value))
        .ok_or_else(|| invalid("Invalid Dev image SHA-256 digest"))
}

fn candidate_fields(identity: &Value, actual: &Value) -> io::Result<Value> {
    if !lower_hex(text(&actual["archiveSha256"]), 64) {
        return Err(invalid("Invalid Dev image archive SHA-256"));
    }
    let mut candidate = canonical_identity(identity)?;
    candidate["schemaVersion"] = json!(1);
    candidate["policy"] = json!(POLICY);
    candidate["archiveSha256"] = actual["archiveSha256"].clone();
    candidate["digest"] = json!(digest(&actual["manifestDigest"])?);
    candidate["imageId"] = json!(digest(&actual["imageId"])?);
    candidate["checks"] = json!([
        "runtime-vulnerabilities",
        "isolated-appliance",
        "native-core-integration",
    ]);
    Ok(candidate)
}

pub(super) fn candidate(identity: &Value, actual: &Value) -> io::Result<Value> {
    let candidate = candidate_fields(identity, actual)?;
    let manifest = &actual["manifest"];
    let layers = manifest["layers"]
        .as_array()
        .filter(|layers| !layers.is_empty());
    if manifest["schemaVersion"] != 2
        || manifest["mediaType"] != MANIFEST_TYPE
        || record(manifest)?.contains_key("manifests")
        || manifest["config"]["digest"] != candidate["imageId"]
        || layers.is_none()
    {
        return Err(invalid("Dev image must be a single OCI image manifest"));
    }
    for layer in layers.into_iter().flatten() {
        digest(&layer["digest"])?;
    }
    let config = &actual["config"];
    let runtime = record(&config["config"])?;
    let labels = record(runtime.get("Labels").unwrap_or(&Value::Null))?;
    let healthcheck = &config["config"]["Healthcheck"];
    if config["os"] != "linux"
        || config["architecture"] != "amd64"
        || healthcheck["Disabled"] == true
        || healthcheck["Test"] != json!(["CMD", "container-healthcheck.sh"])
        || labels.get("org.opencontainers.image.revision") != Some(&identity["revision"])
        || labels.get("org.opencontainers.image.version") != Some(&identity["version"])
        || labels.get("org.opencontainers.image.source")
            != Some(&json!("https://github.com/RentnerProxy/marketplace"))
        || labels.get("org.opencontainers.image.title")
            != Some(&json!("RentnerProxy Marketplace Dev"))
    {
        return Err(invalid(
            "Dev image platform or OCI labels do not match its identity",
        ));
    }
    Ok(candidate)
}

pub(super) fn validate_candidate(
    value: &Value,
    identity: &Value,
    actual: &Value,
) -> io::Result<Value> {
    let expected = candidate(identity, actual)?;
    if value != &expected {
        return Err(invalid("Dev candidate evidence mismatch"));
    }
    Ok(expected)
}

pub(super) fn loaded_image<'a>(config: &Value, loaded: &'a Value) -> io::Result<&'a str> {
    let expected_config = record(&config["config"])?;
    let loaded_config = record(&loaded["Config"])?;
    let expected_root = &config["rootfs"];
    let loaded_root = &loaded["RootFS"];
    let healthcheck = &config["config"]["Healthcheck"];
    let commands = healthcheck["Test"].as_array();
    if healthcheck["Disabled"] == true
        || !commands.is_some_and(|commands| {
            matches!(
                commands.first().and_then(Value::as_str),
                Some("CMD" | "CMD-SHELL")
            ) && commands.len() >= 2
                && commands[1..]
                    .iter()
                    .all(|value| !text(value).trim().is_empty())
        })
    {
        return Err(invalid(
            "Loaded Dev image requires an enabled OCI healthcheck",
        ));
    }
    let layers = expected_root["diff_ids"]
        .as_array()
        .filter(|layers| !layers.is_empty());
    if config["os"] != "linux"
        || config["architecture"] != "amd64"
        || loaded["Os"] != "linux"
        || loaded["Architecture"] != "amd64"
        || expected_root["type"] != "layers"
        || loaded_root["Type"] != "layers"
        || layers.is_none()
    {
        return Err(invalid(
            "Loaded Dev image platform or root filesystem mismatch",
        ));
    }
    for layer in layers.into_iter().flatten() {
        digest(layer)?;
    }
    if loaded_root["Layers"] != expected_root["diff_ids"]
        || expected_config
            .iter()
            .any(|(key, value)| loaded_config.get(key) != Some(value))
    {
        return Err(invalid("Loaded Dev image runtime configuration mismatch"));
    }
    digest(&loaded["Id"])
}

fn canonical_candidate(value: &Value) -> io::Result<()> {
    let identity = json!({
        "repository": value["repository"], "image": value["image"],
        "revision": value["revision"], "version": value["version"],
        "immutableTag": value["immutableTag"], "platforms": value["platforms"],
        "runId": value["runId"], "runAttempt": value["runAttempt"],
    });
    let expected = candidate_fields(
        &identity,
        &json!({
            "archiveSha256": value["archiveSha256"], "manifestDigest": value["digest"], "imageId": value["imageId"],
        }),
    )?;
    if value != &expected {
        return Err(invalid("Invalid Dev candidate evidence"));
    }
    Ok(())
}

fn timestamp(value: &Value) -> io::Result<&str> {
    let stamp = text(value);
    if stamp.len() != 24
        || !stamp.is_ascii()
        || &stamp[10..11] != "T"
        || &stamp[19..20] != "."
        || !stamp.ends_with('Z')
        || !stamp[20..23].bytes().all(|byte| byte.is_ascii_digit())
        || stamp[17..19] == *"60"
        || OffsetDateTime::parse(stamp, &Rfc3339).is_err()
    {
        return Err(invalid("Dev evidence requires a canonical ISO timestamp"));
    }
    Ok(stamp)
}

pub(super) fn assessment(candidate: &Value, stamp: &Value) -> io::Result<Value> {
    canonical_candidate(candidate)?;
    Ok(json!({
        "schemaVersion": 1,
        "policy": POLICY,
        "verdict": "marketplace-dev-approved",
        "repository": candidate["repository"],
        "image": candidate["image"],
        "revision": candidate["revision"],
        "digest": candidate["digest"],
        "version": candidate["version"],
        "platforms": candidate["platforms"],
        "runId": candidate["runId"],
        "runAttempt": candidate["runAttempt"],
        "assessedAt": timestamp(stamp)?,
        "checks": [
            "typescript",
            "rust",
            "bun-advisories",
            "cargo-advisories",
            "runtime-vulnerabilities",
            "isolated-appliance",
            "native-core-integration",
            "publisher-runtime-vulnerabilities",
        ],
    }))
}

pub(super) fn publication(
    candidate: &Value,
    remote_digests: &Value,
    stamp: &Value,
) -> io::Result<Value> {
    canonical_candidate(candidate)?;
    let expected = digest(&candidate["digest"])?;
    if digest(&remote_digests["immutable"])? != expected
        || digest(&remote_digests["dev"])? != expected
    {
        return Err(invalid(
            "Published Dev tags do not match the approved image digest",
        ));
    }
    Ok(json!({
        "schemaVersion": 1,
        "published": true,
        "image": candidate["image"],
        "revision": candidate["revision"],
        "digest": expected,
        "reference": format!("{IMAGE}@{expected}"),
        "version": candidate["version"],
        "platforms": candidate["platforms"],
        "runId": candidate["runId"],
        "runAttempt": candidate["runAttempt"],
        "tags": [candidate["immutableTag"], "dev"],
        "publishedAt": timestamp(stamp)?,
    }))
}
