use marketplace_artifacts::invalid;
use rentnerproxy_app_contracts::Contracts;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Work {
    status: String,
    approval: Approval,
    run: Option<Value>,
    publication: Option<Value>,
    revocation: Option<Value>,
}

#[derive(Deserialize)]
struct Approval {
    candidate: Candidate,
}

#[derive(Deserialize)]
struct Candidate {
    release: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Plan {
    catalog: Value,
    work: Work,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Publish {
    catalog: Value,
    release: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum ReleaseState {
    Absent,
    Draft,
    Published,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Recovery {
    state: ReleaseState,
    stopped: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stop {
    catalog: Value,
    work: Work,
    previous_run: bool,
}

fn entries<'a>(catalog: &'a Value, name: &str) -> io::Result<&'a Vec<Value>> {
    catalog[name]
        .as_array()
        .ok_or_else(|| invalid("Invalid trusted catalog"))
}

fn matches(left: &Value, right: &Value) -> bool {
    left["appId"].as_str().is_some()
        && left["version"].as_str().is_some()
        && left["appId"] == right["appId"]
        && left["version"] == right["version"]
}

fn matching<'a>(entries: &'a [Value], release: &Value) -> Option<&'a Value> {
    entries.iter().find(|entry| matches(entry, release))
}

fn plan(catalog: &Value, work: Work) -> io::Result<&'static str> {
    let release = &work.approval.candidate.release;
    let signed_release = matching(entries(catalog, "releases")?, release);
    let signed_stop = matching(entries(catalog, "revocations")?, release);
    if signed_release.is_some_and(|existing| existing != release) {
        return Err(invalid(
            "Published app version conflicts with the Marketplace approval",
        ));
    }
    if work.publication.is_some() {
        return Ok(if work.revocation.is_some() {
            "revoke"
        } else {
            "idle"
        });
    }
    let exists = signed_release.is_some() || signed_stop.is_some();
    if work.run.is_some() {
        if exists && work.revocation.is_some() {
            return Ok("revokePrior");
        }
        if signed_release.is_some() {
            return Ok("recordPrior");
        }
    }
    if exists {
        return Err(invalid("App version already used in the signed catalog"));
    }
    Ok(if work.run.is_some() {
        "inspect"
    } else if work.status == "approved" {
        "publish"
    } else {
        "idle"
    })
}

fn next_catalog(
    catalog: &Value,
    releases: Vec<Value>,
    revocations: Vec<Value>,
) -> io::Result<Value> {
    let revision = catalog["revision"]
        .as_u64()
        .and_then(|value| value.checked_add(1))
        .filter(|value| *value <= 9_007_199_254_740_991)
        .ok_or_else(|| invalid("Invalid next catalog revision"))?;
    Ok(json!({
        "formatVersion": catalog["formatVersion"],
        "revision": revision,
        "releases": releases,
        "revocations": revocations,
    }))
}

fn stop(input: Stop) -> io::Result<Value> {
    if input.work.publication.is_none() && !input.previous_run {
        return Err(invalid("Revocation has no matching publication and stop"));
    }
    let stop = input
        .work
        .revocation
        .ok_or_else(|| invalid("Revocation has no matching publication and stop"))?;
    let release = input.work.approval.candidate.release;
    if !matches(&stop, &release) {
        return Err(invalid("Revocation names a different app version"));
    }
    let releases = entries(&input.catalog, "releases")?;
    let revocations = entries(&input.catalog, "revocations")?;
    if let Some(previous) = matching(revocations, &release) {
        return if previous == &stop {
            Ok(Value::Null)
        } else {
            Err(invalid("Signed revocation differs from the recorded stop"))
        };
    }
    if !input.previous_run && matching(releases, &release) != Some(&release) {
        return Err(invalid("Revocation has no matching signed app version"));
    }
    let active = releases
        .iter()
        .filter(|entry| !matches(entry, &release))
        .cloned()
        .collect();
    let mut stopped = revocations.clone();
    stopped.push(stop);
    next_catalog(&input.catalog, active, stopped)
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation {
        "plan" => {
            let input: Plan = serde_json::from_value(input)?;
            Ok(json!(plan(&input.catalog, input.work)?))
        }
        "recovery" => {
            let input: Recovery = serde_json::from_value(input)?;
            Ok(json!(match (input.state, input.stopped) {
                (ReleaseState::Published, true) => "revoke",
                (ReleaseState::Draft, true) => "discardDraft",
                (ReleaseState::Absent, _) => "reset",
                _ => "publish",
            }))
        }
        "publish" => {
            let Publish { catalog, release } = serde_json::from_value(input)?;
            Contracts::new()
                .map_err(io::Error::other)?
                .validate_release(&release)
                .map_err(|error| invalid(format!("Invalid catalog release: {error}")))?;
            let mut releases = entries(&catalog, "releases")?.clone();
            let revocations = entries(&catalog, "revocations")?;
            if matching(&releases, &release).is_some() || matching(revocations, &release).is_some()
            {
                return Err(invalid("App version already used in the signed catalog"));
            }
            releases.push(release);
            next_catalog(&catalog, releases, revocations.clone())
        }
        "stop" => stop(serde_json::from_value(input)?),
        _ => Err(invalid("Unknown catalog publication operation")),
    }
}
