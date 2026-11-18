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
