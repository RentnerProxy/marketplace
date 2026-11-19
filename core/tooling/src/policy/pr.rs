use crate::security::{invalid, string};
use serde_json::{Value, json};
use std::io;

const SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(super) fn initial(input: &Value) -> io::Result<Value> {
    let pull = &input["pull"];
    let repository = string(input, "repository")?;
    if pull["state"] != "open"
        || pull["base"]["ref"] != "main"
        || !pull["base"]["repo"]["full_name"]
            .as_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(repository))
        || !pull["head"]["repo"].is_object()
    {
        return Ok(json!(
            "Pull request is no longer open against this repository’s main branch"
        ));
    }
    if pull["mergeable"] == false {
        return Ok(json!("Merge conflict requires manual resolution"));
    }
    Ok(Value::Null)
}

pub(super) fn comparison(input: &Value) -> io::Result<Value> {
    let ahead = input["ahead"]
        .as_u64()
        .filter(|ahead| *ahead <= SAFE_INTEGER)
        .ok_or_else(|| invalid("Invalid branch comparison"))?;
    let pull = &input["pull"];
    if ahead > 0 {
        let repository = string(input, "repository")?;
        if !pull["head"]["repo"]["full_name"]
            .as_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(repository))
            && pull["maintainer_can_modify"] != true
        {
            return Ok(
                json!({"decision": "skip", "reason": "Fork owner has not allowed maintainer branch updates"}),
            );
        }
        return Ok(json!({"decision": "update"}));
    }
    if pull["draft"] != false || pull["user"]["login"] != "dependabot[bot]" {
        return Ok(
            json!({"decision": "skip", "reason": "Branch is current; automatic merging is limited to Dependabot updates"}),
        );
    }
    if pull["mergeable"] != true {
        return Ok(
            json!({"decision": "skip", "reason": "GitHub is still calculating mergeability"}),
        );
    }
    Ok(json!({"decision": "eligible"}))
}

pub(super) fn successful_checks(input: &Value) -> io::Result<bool> {
    let response = &input["response"];
    if response.get("errors").is_some() {
        return Err(invalid("GitHub CI query failed"));
    }
    let head = string(input, "headSha")?;
    let base = string(input, "baseSha")?;
    let pull = &response["data"]["repository"]["pullRequest"];
    if pull["headRefOid"] != head
        || pull["baseRefOid"] != base
        || pull["state"] != "OPEN"
        || pull["isDraft"] != false
        || pull["reviewDecision"] == "CHANGES_REQUESTED"
    {
        return Ok(false);
    }
    let threads = &pull["reviewThreads"];
    if threads["pageInfo"]["hasNextPage"] != false
        || threads["nodes"]
            .as_array()
            .is_none_or(|nodes| nodes.iter().any(|thread| thread["isResolved"] != true))
    {
        return Ok(false);
    }
    let Some([last]) = pull["commits"]["nodes"].as_array().map(Vec::as_slice) else {
        return Ok(false);
    };
    let commit = &last["commit"];
    Ok(commit["oid"] == head && commit["statusCheckRollup"]["state"] == "SUCCESS")
}

pub(super) fn snapshot_current(input: &Value) -> io::Result<bool> {
    let pull = &input["pull"];
    Ok(pull["head"]["sha"] == string(input, "headSha")?
        && pull["base"]["sha"] == string(input, "baseSha")?
        && pull["mergeable"] == true)
}
