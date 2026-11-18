use marketplace_app_pipeline::publication::execute;
use serde_json::{Value, json};

fn release() -> Value {
    json!({"appId": "publisher.app", "version": "1.2.3", "publisher": {"name": "Original"}})
}

fn revocation() -> Value {
    json!({
        "appId": "publisher.app", "version": "1.2.3",
        "reason": "security", "revokedAt": "2026-11-19T12:00:00.000Z",
    })
}

fn catalog(releases: &[Value], revocations: &[Value]) -> Value {
    json!({"formatVersion": 1, "revision": 23, "releases": releases, "revocations": revocations})
}

fn work() -> Value {
    json!({
        "status": "approved",
        "approval": {"candidate": {"release": release()}},
        "publication": null, "run": null, "revocation": null,
    })
}

fn plan(catalog: &Value, work: &Value) -> std::io::Result<Value> {
    execute("plan", json!({"catalog": catalog, "work": work}))
}

fn stop(catalog: &Value, work: &Value, previous_run: bool) -> std::io::Result<Value> {
    execute(
        "stop",
        json!({"catalog": catalog, "work": work, "previousRun": previous_run}),
    )
}

#[test]
fn publisher_plan_reconciles_prior_runs_and_refuses_a_conflicting_signed_release() {
    let empty = catalog(&[], &[]);
    let published = catalog(&[release()], &[]);
    let stopped = catalog(&[], &[revocation()]);
    let mut current = work();
    assert_eq!(plan(&empty, &current).unwrap(), "publish");
    current["status"] = json!("withdrawn");
    assert_eq!(plan(&empty, &current).unwrap(), "idle");
    assert!(
        plan(&published, &current)
            .unwrap_err()
            .to_string()
            .contains("already used")
    );
    assert!(
        plan(&stopped, &current)
            .unwrap_err()
            .to_string()
            .contains("already used")
    );

    current["run"] = json!({"runId":"123", "attempt":1});
    assert_eq!(plan(&empty, &current).unwrap(), "inspect");
    assert_eq!(plan(&published, &current).unwrap(), "recordPrior");
    current["revocation"] = revocation();
    assert_eq!(plan(&published, &current).unwrap(), "revokePrior");
    assert_eq!(plan(&stopped, &current).unwrap(), "revokePrior");

    current["publication"] = json!({"catalogRevision":23});
    assert_eq!(plan(&published, &current).unwrap(), "revoke");
    current["revocation"] = Value::Null;
    assert_eq!(plan(&published, &current).unwrap(), "idle");
    let mut competing_release = release();
    competing_release["publisher"]["name"] = json!("Changed after approval");
    let conflict = catalog(&[competing_release], &[]);
    assert!(
        plan(&conflict, &current)
            .unwrap_err()
            .to_string()
            .contains("conflicts with the Marketplace approval")
    );
    let invalid_catalog = json!({"releases": [], "revocations": null});
    assert!(
        plan(&invalid_catalog, &current)
            .unwrap_err()
            .to_string()
            .contains("trusted catalog")
    );
}

#[test]
fn recovery_uses_release_state_and_stop_without_promoting_stopped_drafts() {
    for (state, stopped, expected) in [
        ("absent", false, "reset"),
        ("absent", true, "reset"),
        ("draft", false, "publish"),
        ("draft", true, "discardDraft"),
        ("published", false, "publish"),
        ("published", true, "revoke"),
    ] {
        assert_eq!(
            execute("recovery", json!({"state": state, "stopped": stopped})).unwrap(),
            expected
        );
    }
    assert!(execute("recovery", json!({"state": "unknown", "stopped": false})).is_err());
}

#[test]
fn stop_is_bound_to_the_recorded_release_and_retries_the_identical_revocation() {
    let unrelated_release = json!({"appId": "publisher.other", "version": "1.2.3"});
    let unrelated_stop =
        json!({"appId": "publisher.app", "version": "1.2.2", "reason": "withdrawn"});
    let active = catalog(
        &[unrelated_release.clone(), release()],
        std::slice::from_ref(&unrelated_stop),
    );
    let mut current = work();
    assert!(
        stop(&active, &current, false)
            .unwrap_err()
            .to_string()
            .contains("no matching publication and stop")
    );
    assert!(
        stop(&active, &current, true)
            .unwrap_err()
            .to_string()
            .contains("no matching publication and stop")
    );
    current["publication"] = json!({"catalogRevision":23});
    current["revocation"] = unrelated_stop.clone();
    assert!(
        stop(&active, &current, false)
            .unwrap_err()
            .to_string()
            .contains("different app version")
    );
    current["revocation"] = revocation();

    let updated = stop(&active, &current, false).unwrap();
    assert_eq!(
        updated,
        json!({
            "formatVersion":1, "revision":24, "releases":[unrelated_release],
            "revocations":[unrelated_stop, revocation()],
        })
    );
    assert_eq!(stop(&updated, &current, false).unwrap(), Value::Null);
    current["revocation"]["reason"] = json!("withdrawn");
    assert!(
        stop(&updated, &current, false)
            .unwrap_err()
            .to_string()
            .contains("differs from the recorded stop")
    );

    current["revocation"] = revocation();
    let unsigned = catalog(&[], &[]);
    assert!(
        stop(&unsigned, &current, false)
            .unwrap_err()
            .to_string()
            .contains("no matching signed app version")
    );
    current["publication"] = Value::Null;
    assert_eq!(
        stop(&unsigned, &current, true).unwrap()["revocations"],
        json!([revocation()])
    );
}

#[test]
fn catalog_updates_preserve_existing_entries_and_reject_reuse_or_revision_overflow() {
    let older = json!({"appId":"publisher.app", "version":"1.2.2"});
    let empty = catalog(std::slice::from_ref(&older), &[]);
    let next = execute("publish", json!({"catalog":empty, "release":release()})).unwrap();
    assert_eq!(next["revision"], 24);
    assert_eq!(next["releases"], json!([older, release()]));
    let stopped = catalog(&[], &[revocation()]);
    for catalog in [next, stopped] {
        assert!(
            execute("publish", json!({"catalog":catalog, "release":release()}))
                .unwrap_err()
                .to_string()
                .contains("already used")
        );
    }
    let mut overflow = empty;
    overflow["revision"] = json!(9_007_199_254_740_991_u64);
    assert!(
        execute("publish", json!({"catalog":overflow, "release":release()}))
            .unwrap_err()
            .to_string()
            .contains("next catalog revision")
    );
}
