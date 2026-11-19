use crate::security::{files, invalid, lower_hex, sha256_digest, string};
use regex::Regex;
use serde_json::{Value, json};
use std::io;
use std::path::Path;
use std::sync::LazyLock;

const REPOSITORY: &str = "RentnerProxy/marketplace";
const IMAGE: &str = "ghcr.io/rentnerproxy/marketplace";
const MAX_ASSET: u64 = 4 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(crate) fn identity(tag: &str) -> io::Result<Value> {
    static TAG: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\Av(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(alpha|beta|rc)\.(?:0|[1-9][0-9]*))?\z").expect("official release tag regex")
    });
    let captures = TAG
        .captures(tag)
        .ok_or_else(|| invalid("Expected an official vSemVer release tag"))?;
    let prerelease = captures.get(1);
    Ok(json!({
        "tag": tag,
        "prerelease": prerelease.is_some(),
        "channel": prerelease.map_or("latest", |part| part.as_str()),
    }))
}

fn tag_context(input: &Value) -> io::Result<()> {
    identity(string(input, "tag")?)?;
    let revision = string(input, "revision")?;
    if input["repository"] != REPOSITORY || input["refType"] != "tag" || !lower_hex(revision, 40) {
        return Err(invalid("Expected the official Marketplace tagged revision"));
    }
    if input["localRevision"] != revision {
        return Err(invalid("Release checkout must match the tagged revision"));
    }
    Ok(())
}

fn changelog_name(tag: &str) -> io::Result<String> {
    identity(tag)?;
    Ok(format!("Marketplace-{tag}-CHANGELOG.md"))
}

fn prepared_changelog(input: &Value) -> io::Result<Vec<u8>> {
    let name = changelog_name(string(input, "tag")?)?;
    let root = Path::new(string(input, "directory")?);
    if !root.is_absolute() {
        return Err(invalid("Changelog requires the runner temporary directory"));
    }
    files::no_links(root, Path::new(&name))?;
    let bytes = files::read(&root.join(name), MAX_ASSET)?;
    if bytes.is_empty() {
        return Err(invalid("Prepared changelog is missing"));
    }
    Ok(bytes)
}

fn expected_image_digest(value: &Value) -> io::Result<&str> {
    value
        .as_str()
        .filter(|value| sha256_digest(value))
        .ok_or_else(|| invalid("Expected a valid Marketplace image digest"))
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation.strip_prefix("release-").unwrap_or(operation) {
        "identity" => identity(string(&input, "tag")?),
        "publication" => {
            let tag = string(&input, "tag")?;
            let identity = identity(tag)?;
            // The first Marketplace alpha explicitly occupies Latest on GitHub.
            let prerelease = tag != "v1.0.0-alpha.1" && identity["prerelease"] == true;
            Ok(
                json!({ "prerelease": prerelease, "make_latest": if prerelease { "false" } else { "true" } }),
            )
        }
        "tag-context" => {
            tag_context(&input)?;
            Ok(Value::Null)
        }
        "tag-provenance" => {
            tag_context(&input)?;
            if input["remoteRevision"] != input["revision"] {
                return Err(invalid(
                    "Remote Marketplace tag does not identify the checked out revision",
                ));
            }
            if !matches!(input["comparison"].as_str(), Some("ahead" | "identical")) {
                return Err(invalid(
                    "Marketplace main does not contain the tagged revision",
                ));
            }
            Ok(Value::Null)
        }
        "existing-metadata" => {
            let tag = string(&input, "tag")?;
            identity(tag)?;
            let existing = &input["existing"];
            let id = existing["id"]
                .as_u64()
                .filter(|id| (1..=MAX_SAFE_INTEGER).contains(id));
            if existing["tag_name"] != tag || id.is_none() {
                return Err(invalid("Existing release identity is invalid"));
            }
            let body = match existing.get("body") {
                Some(Value::Null) => "",
                Some(Value::String(body)) => body,
                _ => return Err(invalid("Existing release body is invalid")),
            };
            Ok(json!({ "id": id, "body": body }))
        }
        "image-reference" => {
            let image = string(&input, "image")?;
            if !image
                .strip_prefix(IMAGE)
                .and_then(|suffix| suffix.strip_prefix('@'))
                .is_some_and(sha256_digest)
            {
                return Err(invalid(
                    "Expected the exact verified Marketplace image digest",
                ));
            }
            Ok(Value::Null)
        }
        "image-id" => Ok(json!(expected_image_digest(&input["imageId"])?)),
        "existing-image" => {
            let image_id = expected_image_digest(&input["imageId"])?;
            let manifest = files::json(Path::new(string(&input, "path")?), MAX_ASSET)?;
            if manifest["config"]["digest"] != image_id {
                return Err(invalid(
                    "Version image already exists with different content; refusing overwrite.",
                ));
            }
            Ok(Value::Null)
        }
        "published-image" => {
            let digest = expected_image_digest(&input["versionDigest"])?;
            if input["channelDigest"] != digest {
                return Err(invalid(
                    "Published channel does not match the immutable Marketplace image",
                ));
            }
            Ok(json!(format!("{IMAGE}@{digest}")))
        }
        "changelog" => {
            let prepared = prepared_changelog(&input)?;
            if let Some(published) = input.get("published") {
                let path = published
                    .as_str()
                    .ok_or_else(|| invalid("Invalid downloaded changelog path"))?;
                if files::read(Path::new(path), MAX_ASSET)? != prepared {
                    return Err(invalid(
                        "Published changelog differs; refusing to overwrite it.",
                    ));
                }
            }
            Ok(json!(changelog_name(string(&input, "tag")?)?))
        }
        _ => Err(invalid("Unknown release operation")),
    }
}
