use crate::security::{invalid, string};
use regex::Regex;
use serde_json::{Value, json};
use std::io;
use std::sync::LazyLock;

mod dependabot;
mod pr;

fn validate_title(value: &Value) -> bool {
    static TITLE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\A(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9./_-]*\))?!?: \S(?:[^\r\n]*\S)?\z").expect("Conventional Commit PR title regex")
    });
    value.as_str().is_some_and(|title| TITLE.is_match(title))
}

fn pull_request_labels(value: &Value) -> io::Result<Value> {
    let files = value
        .as_array()
        .ok_or_else(|| invalid("Expected changed pull request files"))?;
    let mut paths = Vec::with_capacity(files.len());
    for file in files {
        paths.push(string(file, "filename")?);
    }
    let mut labels = Vec::new();
    if paths
        .iter()
        .any(|path| path.starts_with("web/src/") || matches!(*path, "package.json" | "bun.lock"))
    {
        labels.push("area: web");
    }
    if paths.iter().any(|path| path.starts_with("core/")) {
        labels.push("area: core");
    }
    if paths
        .iter()
        .any(|path| path.starts_with(".github/") || *path == ".coderabbit.yaml")
    {
        labels.push("area: automation");
    }
    if paths.iter().any(|path| {
        path.starts_with("docker/") || matches!(*path, "Dockerfile" | "docker-compose.yml")
    }) {
        labels.push("area: appliance");
    }
    Ok(json!(labels))
}

fn workflow_errors(input: &Value) -> io::Result<Value> {
    static PR_HEAD: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r#"(?ix)\bgithub
                (?:\s*\.\s*event\b|\s*\[\s*['"]event['"]\s*\])
                (?:\s*\.\s*pull_request\b|\s*\[\s*['"]pull_request['"]\s*\])
                (?:\s*\.\s*head\b|\s*\[\s*['"]head['"]\s*\])"#,
        )
        .expect("GitHub PR head expression regex")
    });
    let file = string(input, "file")?;
    let source = string(input, "source")?;
    let workflow = input["workflow"]
        .as_object()
        .ok_or_else(|| invalid("Invalid workflow object"))?;
    let mut errors = Vec::new();
    let has_key = |key| {
        workflow
            .get(key)
            .is_some_and(|value| !value.is_null() && value != false)
    };
    let legacy_image = file.ends_with("/image.yml") || file.ends_with("\\image.yml");
    if !has_key("permissions") || (!has_key("concurrency") && !legacy_image) {
        errors.push(format!(
            "{file}: missing default permissions or concurrency"
        ));
    }
    let jobs = workflow
        .get("jobs")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("Invalid workflow jobs"))?;
    let check_action = |action: &Value, errors: &mut Vec<String>| {
        if !action.as_str().is_some_and(|action| {
            action.starts_with("./")
                || action.rsplit_once('@').is_some_and(|(name, rev)| {
                    !name.is_empty() && crate::security::lower_hex(rev, 40)
                })
        }) {
            errors.push(format!("{file}: action must use a full commit SHA"));
        }
    };
    for (name, job) in jobs {
        let job = job
            .as_object()
            .ok_or_else(|| invalid("Invalid workflow job"))?;
        if let Some(action) = job.get("uses") {
            check_action(action, &mut errors);
        } else if !job.get("timeout-minutes").is_some_and(|value| {
            value.as_u64().is_some_and(|value| value > 0)
                || value.as_str().is_some_and(|value| !value.trim().is_empty())
        }) {
            errors.push(format!("{file}/{name}: missing timeout"));
        }
        if let Some(steps) = job.get("steps") {
            let steps = steps
                .as_array()
                .ok_or_else(|| invalid("Invalid workflow steps"))?;
            for step in steps {
                if let Some(action) = step.get("uses") {
                    check_action(action, &mut errors);
                }
                if step["with"]["persist-credentials"] == true
                    || step["with"]["persist-credentials"] == "true"
                {
                    errors.push(format!("{file}: persisted checkout credentials"));
                }
            }
        }
    }
    let event = workflow
        .get("on")
        .ok_or_else(|| invalid("Invalid workflow trigger"))?;
    let privileged = event.get("pull_request_target").is_some()
        || event == "pull_request_target"
        || event
            .as_array()
            .is_some_and(|events| events.iter().any(|event| event == "pull_request_target"));
    if privileged && PR_HEAD.is_match(source) {
        errors.push(format!(
            "{file}: privileged workflow must not execute PR source"
        ));
    }
    Ok(json!(errors))
}

pub fn execute(operation: &str, input: Value) -> io::Result<Value> {
    match operation.strip_prefix("policy-").unwrap_or(operation) {
        "workflow" => workflow_errors(&input),
        "pr-title" => Ok(json!(validate_title(&input["title"]))),
        "pr-labels" => pull_request_labels(&input["files"]),
        "pr-initial" => pr::initial(&input),
        "pr-comparison" => pr::comparison(&input),
        "pr-successful-checks" => Ok(json!(pr::successful_checks(&input)?)),
        "pr-current" => Ok(json!(pr::snapshot_current(&input)?)),
        "dependabot-trailers" => dependabot::trailers(&input),
        "dependabot-eligibility" => Ok(dependabot::evaluate(&input)),
        _ => Err(invalid("Unknown policy operation")),
    }
}
