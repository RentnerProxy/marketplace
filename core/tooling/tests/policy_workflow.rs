use marketplace_tooling::policy::execute;
use serde_json::{Value, json};
use std::io;

fn workflow(trigger: Value, source: &str) -> Value {
    json!({
        "file": ".github/workflows/pr-fixture.yml",
        "source": source,
        "workflow": {
            "on": trigger,
            "permissions": { "contents": "read" },
            "concurrency": { "group": "test" },
            "jobs": {
                "gate": { "timeout-minutes": 5, "steps": [
                    { "uses": format!("actions/checkout@{}", "a".repeat(40)), "with": {"persist-credentials": false} }
                ] },
                "local": { "uses": "./.github/workflows/ci.yml" },
            },
        },
    })
}

#[test]
fn privileged_workflow_refuses_pull_request_head_access_in_supported_trigger_forms()
-> io::Result<()> {
    let dot = "ref: ${{ github.event.pull_request.head.sha }}";
    let bracket = "ref: ${{ github['event'].pull_request['head'].sha }}";
    for trigger in [
        json!({"pull_request_target": {"types": ["opened"]}}),
        json!(["push", "pull_request_target"]),
        json!("pull_request_target"),
    ] {
        for source in [dot, bracket] {
            let errors = execute("policy-workflow", workflow(trigger.clone(), source))?;
            let [error] = errors.as_array().expect("array").as_slice() else {
                panic!("Expected one refusal, got {errors}");
            };
            assert!(
                error
                    .as_str()
                    .expect("workflow error")
                    .contains("privileged workflow")
            );
        }
    }
    assert_eq!(
        execute("policy-workflow", workflow(json!(["pull_request"]), dot))?,
        json!([])
    );
    assert_eq!(
        execute(
            "policy-workflow",
            workflow(json!("pull_request_target"), "ref: refs/heads/main")
        )?,
        json!([])
    );
    Ok(())
}

#[test]
fn workflow_checks_normalized_actions_credentials_and_timeouts() -> io::Result<()> {
    let mut input = workflow(json!("pull_request"), "format-independent fixture");
    let jobs = &mut input["workflow"]["jobs"];
    jobs["gate"]["timeout-minutes"] = json!(0);
    jobs["gate"]["steps"][0] = json!({
        "uses": "actions/checkout@main",
        "with": {"persist-credentials": "true"},
    });
    jobs["local"]["uses"] = json!("other/repo/.github/workflows/ci.yml@main");
    let errors = execute("policy-workflow", input)?;
    let errors = errors.as_array().expect("array");
    assert_eq!(errors.len(), 4);
    assert!(
        errors[0]
            .as_str()
            .expect("workflow error")
            .contains("missing timeout")
    );
    assert!(
        errors[1]
            .as_str()
            .expect("workflow error")
            .contains("full commit SHA")
    );
    assert!(
        errors[2]
            .as_str()
            .expect("workflow error")
            .contains("persisted checkout credentials")
    );
    assert!(
        errors[3]
            .as_str()
            .expect("workflow error")
            .contains("full commit SHA")
    );
    Ok(())
}

#[test]
fn workflow_batch_aggregates_single_file_errors_in_input_order() -> io::Result<()> {
    let mut first = workflow(json!("pull_request"), "fixture");
    first["file"] = json!(".github/workflows/first.yaml");
    first["workflow"]["jobs"]["gate"]["timeout-minutes"] = json!(0);
    let valid = workflow(json!("pull_request"), "fixture");
    let last = workflow(
        json!("pull_request_target"),
        "ref: ${{ github.event.pull_request.head.sha }}",
    );
    assert_eq!(
        execute("policy-workflows", json!([first, valid, last]))?,
        json!([
            ".github/workflows/first.yaml/gate: missing timeout",
            ".github/workflows/pr-fixture.yml: privileged workflow must not execute PR source"
        ])
    );
    assert_eq!(execute("policy-workflows", json!([]))?, json!([]));
    Ok(())
}

#[test]
fn workflow_batch_fails_closed_on_malformed_workflow() {
    let mut first = workflow(json!("pull_request"), "fixture");
    first["workflow"]["concurrency"] = Value::Null;
    let mut malformed = workflow(json!("pull_request"), "fixture");
    malformed["workflow"]["jobs"] = Value::Null;
    assert_eq!(
        execute("policy-workflows", json!([first, malformed]))
            .unwrap_err()
            .to_string(),
        "Invalid workflow jobs"
    );
    assert_eq!(
        execute("policy-workflows", json!({}))
            .unwrap_err()
            .to_string(),
        "Expected workflow inputs"
    );
}

#[test]
fn review_approval_requires_complete_successful_current_snapshot() -> io::Result<()> {
    let pull = json!({
        "headRefOid": "head", "baseRefOid": "base", "state": "OPEN",
        "isDraft": false, "reviewDecision": "APPROVED",
        "reviewThreads": { "nodes": [{"isResolved": true}], "pageInfo": {"hasNextPage": false} },
        "commits": { "nodes": [{"commit": {"oid": "head", "statusCheckRollup": {"state": "SUCCESS"}}}] },
    });
    let template = |pull: Value| {
        json!({
            "response": { "data": {"repository": {"pullRequest": pull}} },
            "headSha": "head", "baseSha": "base",
        })
    };
    assert_eq!(
        execute("policy-pr-successful-checks", template(pull.clone()))?,
        true
    );

    let mut pending = pull.clone();
    pending["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"] = json!("PENDING");
    let mut paginated = pull.clone();
    paginated["reviewThreads"]["pageInfo"]["hasNextPage"] = json!(true);
    let mut unresolved = pull.clone();
    unresolved["reviewThreads"]["nodes"][0]["isResolved"] = json!(false);
    let mut stale = pull.clone();
    stale["headRefOid"] = json!("another");
    let mut contested = pull;
    contested["reviewDecision"] = json!("CHANGES_REQUESTED");
    for invalid in [pending, paginated, unresolved, stale, contested] {
        assert_eq!(
            execute("policy-pr-successful-checks", template(invalid))?,
            false
        );
    }

    let mut failed = template(Value::Null);
    failed["response"]["errors"] = json!([{"message": "API refused query"}]);
    assert!(execute("policy-pr-successful-checks", failed).is_err());
    Ok(())
}

#[test]
fn workflow_fails_closed_for_malformed_job_and_step_values() -> io::Result<()> {
    let valid = workflow(json!("pull_request"), "fixture");
    for (key, replacement, error) in [
        ("jobs", json!([]), "Invalid workflow jobs"),
        ("gate", json!([]), "Invalid workflow job"),
        ("steps", json!("not a sequence"), "Invalid workflow steps"),
        ("step", json!(false), "Invalid workflow step"),
        (
            "with",
            json!("persist-credentials: true"),
            "Invalid workflow step inputs",
        ),
    ] {
        let mut input = valid.clone();
        let jobs = &mut input["workflow"]["jobs"];
        match key {
            "jobs" => *jobs = replacement,
            "gate" => jobs["gate"] = replacement,
            "steps" => jobs["gate"]["steps"] = replacement,
            "step" => jobs["gate"]["steps"][0] = replacement,
            "with" => jobs["gate"]["steps"][0]["with"] = replacement,
            _ => unreachable!(),
        }
        assert_eq!(
            execute("policy-workflow", input).unwrap_err().to_string(),
            error
        );
    }

    let mut input = valid;
    input["workflow"]["jobs"]["gate"]["steps"][0]["uses"] = json!(null);
    input["workflow"]["jobs"]["gate"]["steps"][0]["with"]["persist-credentials"] = json!(" TRUE ");
    let errors = execute("policy-workflow", input)?;
    assert_eq!(
        errors,
        json!([
            ".github/workflows/pr-fixture.yml: action must use a full commit SHA",
            ".github/workflows/pr-fixture.yml: persisted checkout credentials",
        ])
    );
    Ok(())
}

#[test]
fn official_checkout_requires_explicit_false_for_credential_persistence() -> io::Result<()> {
    let checkout = format!("Actions/Checkout@{}", "a".repeat(40));
    for (inputs, allowed) in [
        (None, false),
        (Some(json!({"fetch-depth": 1})), false),
        (Some(json!({"persist-credentials": null})), false),
        (Some(json!({"persist-credentials": true})), false),
        (Some(json!({"persist-credentials": " TRUE "})), false),
        (Some(json!({"persist-credentials": 0})), false),
        (Some(json!({"persist-credentials": "off"})), false),
        (Some(json!({"persist-credentials": ["false"]})), false),
        (
            Some(json!({"persist-credentials": "${{ inputs.allow_credentials }}"})),
            false,
        ),
        (Some(json!({"persist-credentials": false})), true),
        (Some(json!({"persist-credentials": " FALSE "})), true),
    ] {
        let mut input = workflow(json!("pull_request"), "checkout fixture");
        let mut step = json!({"uses": checkout});
        if let Some(inputs) = inputs {
            step["with"] = inputs;
        }
        input["workflow"]["jobs"]["gate"]["steps"][0] = step;
        let errors = execute("policy-workflow", input)?;
        if allowed {
            assert_eq!(errors, json!([]));
        } else {
            assert_eq!(
                errors,
                json!([
                    ".github/workflows/pr-fixture.yml: persisted checkout credentials (actions/checkout requires explicit persist-credentials: false)"
                ])
            );
        }
    }

    let mut input = workflow(json!("pull_request"), "unrelated action fixture");
    input["workflow"]["jobs"]["gate"]["steps"][0] =
        json!({"uses": format!("actions/setup-node@{}", "a".repeat(40))});
    assert_eq!(execute("policy-workflow", input)?, json!([]));
    Ok(())
}

#[test]
fn pr_metadata_labels_match_repository_paths_and_reject_malformed_api_entries() -> io::Result<()> {
    assert_eq!(
        execute(
            "policy-pr-title",
            json!({"title":"fix(core): validate receipts"})
        )?,
        true
    );
    assert_eq!(execute("policy-pr-title", json!({"title":false}))?, false);
    let files = json!([
        {"filename":"Dockerfile"}, {"filename":"core/tooling/Cargo.toml"},
        {"filename":".github/workflows/ci.yml"}, {"filename":"bun.lock"},
        {"filename":"README.md"}, {"filename":"web/src/index.ts"},
    ]);
    assert_eq!(
        execute("policy-pr-labels", json!({"files":files}))?,
        json!([
            "area: web",
            "area: core",
            "area: automation",
            "area: appliance"
        ])
    );
    assert_eq!(
        execute(
            "policy-pr-labels",
            json!({"files":[{"filename":"README.md"}]})
        )?,
        json!([])
    );
    assert!(execute("policy-pr-labels", json!({"files":[{"filename":null}]})).is_err());
    assert!(execute("policy-pr-labels", json!({"files":{}})).is_err());
    Ok(())
}
