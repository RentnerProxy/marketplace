use crate::security::invalid;
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;
use std::io;
use std::sync::LazyLock;

const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const DEPENDABOT_EMAIL: &str = "49699333+dependabot[bot]@users.noreply.github.com";

fn object(value: &Value) -> io::Result<&Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| invalid("Missing structured API or metadata object"))
}

fn text(value: &Value) -> io::Result<&str> {
    value
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("Missing API or metadata string"))
}

fn bot(value: &Value) -> bool {
    value["login"] == "dependabot[bot]" && value["id"] == 49_699_333 && value["type"] == "Bot"
}

fn stable_version(version: &str) -> io::Result<[u64; 3]> {
    let version = version.strip_prefix('v').unwrap_or(version);
    let mut parts = version.split('.');
    let mut parsed = [0; 3];
    for part in &mut parsed {
        let value = parts
            .next()
            .filter(|value| {
                !value.is_empty()
                    && (value.len() == 1 || !value.starts_with('0'))
                    && value.bytes().all(|byte| byte.is_ascii_digit())
            })
            .ok_or_else(|| invalid("Unknown, digest-only or prerelease dependency version"))?;
        *part = value
            .parse::<u64>()
            .ok()
            .filter(|number| *number <= SAFE_INTEGER)
            .ok_or_else(|| invalid("Invalid dependency version"))?;
    }
    if parts.next().is_some() {
        return Err(invalid(
            "Unknown, digest-only or prerelease dependency version",
        ));
    }
    Ok(parsed)
}

fn validate_update(previous: &str, next: &str, update_type: &Value) -> io::Result<()> {
    let [old_major, old_minor, old_patch] = stable_version(previous)?;
    let [new_major, new_minor, new_patch] = stable_version(next)?;
    if old_major != new_major
        || (new_minor, new_patch) <= (old_minor, old_patch)
        || (old_major == 0 && old_minor != new_minor)
    {
        return Err(invalid(
            "Major, breaking pre-1.0, downgrade or unchanged dependency update",
        ));
    }
    let expected = if new_minor == old_minor {
        "version-update:semver-patch"
    } else {
        "version-update:semver-minor"
    };
    if update_type != expected {
        return Err(invalid(
            "Dependency update type is unknown or inconsistent with versions",
        ));
    }
    Ok(())
}

fn trailer(message: &str) -> io::Result<(&str, &str)> {
    static TRAILER: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?ms)^---\n(.*?)^\.\.\.(?:\n|\z)").expect("Dependabot metadata trailer regex")
    });
    let mut matches = TRAILER.captures_iter(message);
    let first = matches
        .next()
        .ok_or_else(|| invalid("Missing or ambiguous Dependabot metadata trailer"))?;
    if matches.next().is_some() {
        return Err(invalid("Missing or ambiguous Dependabot metadata trailer"));
    }
    let whole = first.get(0).expect("full match");
    let content = first.get(1).expect("trailer contents").as_str();
    if content.is_empty() {
        return Err(invalid("Invalid Dependabot metadata YAML"));
    }
    Ok((&message[..whole.start()], content))
}

pub(super) fn trailers(input: &Value) -> io::Result<Value> {
    let commits = input["commits"]
        .as_array()
        .ok_or_else(|| invalid("Missing API commits"))?;
    let sources: Vec<Value> = commits
        .iter()
        .map(|value| {
            if let Some(message) = value["commit"]["message"].as_str() {
                let message = message.replace("\r\n", "\n");
                if let Ok((_, source)) = trailer(&message) {
                    return json!(source);
                }
            }
            Value::Null
        })
        .collect();
    Ok(json!(sources))
}

fn validate_metadata(message: &str, metadata: &Value) -> io::Result<()> {
    static UPDATES: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?m)^Updates `(\S+)` from `?(\S+?)`? to `?(\S+?)`?$")
            .expect("grouped Dependabot prose regex")
    });
    static BUMPS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?m)^Bumps .+ from `?(\S+?)`? to `?(\S+?)`?\.$")
            .expect("single Dependabot prose regex")
    });
    let message = message.replace("\r\n", "\n");
    let (prose, source) = trailer(&message)?;
    if metadata["source"] != source || metadata["invalid"] == true {
        return Err(invalid("Invalid Dependabot metadata YAML"));
    }
    let document = &metadata["document"];
    object(document)?;
    let dependencies = document["updated-dependencies"]
        .as_array()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| invalid("Missing dependency update metadata"))?;

    let updates: Vec<_> = UPDATES.captures_iter(prose).collect();
    if !updates.is_empty() {
        if updates.len() != dependencies.len() {
            return Err(invalid("Grouped dependency version metadata is incomplete"));
        }
        for (dependency, update) in dependencies.iter().zip(&updates) {
            if text(&dependency["dependency-name"])? != &update[1]
                || text(&dependency["dependency-version"])? != &update[3]
            {
                return Err(invalid(
                    "Grouped dependency names or versions are inconsistent",
                ));
            }
            validate_update(&update[2], &update[3], &dependency["update-type"])?;
        }
    } else {
        let bumps: Vec<_> = BUMPS.captures_iter(prose).collect();
        let ([dependency], [bump]) = (dependencies.as_slice(), bumps.as_slice()) else {
            return Err(invalid(
                "Missing unambiguous previous and next dependency versions",
            ));
        };
        text(&dependency["dependency-name"])?;
        if text(&dependency["dependency-version"])? != &bump[2] {
            return Err(invalid(
                "Dependency version is inconsistent with signed commit prose",
            ));
        }
        validate_update(&bump[1], &bump[2], &dependency["update-type"])?;
    }
    Ok(())
}

fn validate_commit(value: &Value, metadata: &Value, trusted_login: &Value) -> io::Result<bool> {
    static BOT_LOGIN: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\A[a-z0-9-]+\[bot\]\z").expect("GitHub bot login regex"));
    object(value)?;
    text(&value["sha"])?;
    let parents = value["parents"]
        .as_array()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("Missing commit parents"))?;
    let commit = &value["commit"];
    let committer = &commit["committer"];
    let account = &value["committer"];
    let github_committer = account["login"] == "web-flow"
        && account["id"] == 19_864_447
        && committer["name"] == "GitHub"
        && committer["email"] == "noreply@github.com";
    let bot_committer = bot(account)
        && committer["name"] == "dependabot[bot]"
        && committer["email"] == DEPENDABOT_EMAIL;
    let verification = &commit["verification"];
    if verification["verified"] != true || verification["reason"] != "valid" {
        return Err(invalid("Commit signature is not verified"));
    }
    if parents.len() > 1 {
        let author = &value["author"];
        let trusted_bot = trusted_login
            .as_str()
            .is_some_and(|login| BOT_LOGIN.is_match(login))
            && author["login"] == *trusted_login
            && author["type"] == "Bot"
            && author["id"]
                .as_u64()
                .is_some_and(|id| (1..=SAFE_INTEGER).contains(&id));
        let trusted_committer = account["login"] == *trusted_login
            && account["id"] == author["id"]
            && account["type"] == "Bot";
        if parents.len() != 2 || !trusted_bot || (!github_committer && !trusted_committer) {
            return Err(invalid(
                "Merge commit is not a verified trusted branch-update app commit",
            ));
        }
        return Ok(false);
    }
    let author = &commit["author"];
    if !bot(&value["author"])
        || author["name"] != "dependabot[bot]"
        || author["email"] != DEPENDABOT_EMAIL
        || (!github_committer && !bot_committer)
    {
        return Err(invalid(
            "Nonmerge commit is not a verified authentic Dependabot commit",
        ));
    }
    validate_metadata(text(&commit["message"])?, metadata)?;
    Ok(true)
}

fn dependency_path(path: &str) -> bool {
    static WORKFLOWS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\A\.github/workflows/[A-Za-z0-9_-]+\.ya?ml\z")
            .expect("dependency-owned workflows regex")
    });
    matches!(
        path,
        "package.json"
            | "bun.lock"
            | "core/Cargo.toml"
            | "core/Cargo.lock"
            | "Dockerfile"
            | "docker-compose.yml"
    ) || WORKFLOWS.is_match(path)
}

fn validate(input: &Value) -> io::Result<()> {
    static BREAKING_TITLE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\A[A-Za-z0-9_]+(?:\([^\n]*\))?!:").expect("breaking PR title regex")
    });
    let pr = &input["pullRequest"];
    object(pr)?;
    let base = &pr["base"];
    let head = &pr["head"];
    let repository = text(&input["repository"])?;
    if pr["state"] != "open"
        || pr["draft"] != false
        || !bot(&pr["user"])
        || base["ref"] != "main"
        || !text(&base["repo"]["full_name"])?.eq_ignore_ascii_case(repository)
        || !text(&head["repo"]["full_name"])?.eq_ignore_ascii_case(repository)
        || !text(&head["ref"])?.starts_with("dependabot/")
    {
        return Err(invalid(
            "PR is not an open same-repository Dependabot update targeting main",
        ));
    }
    if BREAKING_TITLE.is_match(text(&pr["title"])?) {
        return Err(invalid("PR is explicitly marked as a breaking update"));
    }
    if let Some(labels) = pr["labels"].as_array() {
        for label in labels {
            let name = text(&label["name"])?.to_ascii_lowercase();
            if name.contains("breaking") || name.contains("major") {
                return Err(invalid("PR is explicitly marked as a breaking update"));
            }
        }
    }

    let commits = input["commits"]
        .as_array()
        .ok_or_else(|| invalid("Missing API commits"))?;
    let files = input["files"]
        .as_array()
        .ok_or_else(|| invalid("Missing API changed files"))?;
    let metadata = input["metadata"]
        .as_array()
        .ok_or_else(|| invalid("Missing parsed Dependabot metadata"))?;
    let head_sha = text(&head["sha"])?;
    let commit_shas = commits
        .iter()
        .map(|commit| text(&commit["sha"]))
        .collect::<io::Result<BTreeSet<_>>>()?;
    if commits.is_empty()
        || files.is_empty()
        || pr["commits"].as_u64() != Some(commits.len() as u64)
        || pr["changed_files"].as_u64() != Some(files.len() as u64)
        || !commit_shas.contains(head_sha)
        || commit_shas.len() != commits.len()
        || metadata.len() != commits.len()
    {
        return Err(invalid(
            "Current commit or changed-file API coverage is incomplete",
        ));
    }
    let mut dependency_commits = 0;
    for (commit, metadata) in commits.iter().zip(metadata) {
        if validate_commit(commit, metadata, &input["trustedMergeBotLogin"])? {
            dependency_commits += 1;
        }
    }
    if dependency_commits == 0 {
        return Err(invalid("No authenticated dependency update commit"));
    }
    for file in files {
        if file["status"] != "modified"
            || file.get("previous_filename").is_some()
            || !dependency_path(text(&file["filename"])?)
        {
            return Err(invalid(
                "PR changes files outside the dependency-owned allowlist",
            ));
        }
    }
    Ok(())
}

pub(super) fn evaluate(input: &Value) -> Value {
    match validate(input) {
        Ok(()) => json!({
            "eligible": true,
            "reason": "Verified dependency-only stable minor or patch update",
        }),
        Err(error) => json!({ "eligible": false, "reason": error.to_string() }),
    }
}
