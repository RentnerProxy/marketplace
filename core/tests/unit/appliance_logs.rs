use super::*;

#[test]
fn mirrors_core_events_with_the_service_field_emitted_by_the_application_logger() {
    let logs = LogStore::new(vec!["synthetic-secret".into()]);
    for role in ["webserver", "worker"] {
        logs.append(
            role,
            r#"{"level":"info","event":"core.archive_completed","service":"core","password":"synthetic-secret"}"#,
            false,
        );
    }
    let snapshot = logs.snapshot("core");
    let entries = snapshot["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert!(
        entries
            .iter()
            .all(|entry| entry["event"] == "core.archive_completed")
    );
    assert!(!snapshot.to_string().contains("synthetic-secret"));
    for role in ["webserver", "worker"] {
        assert_eq!(logs.snapshot(role)["entries"].as_array().unwrap().len(), 1);
    }
}

#[test]
fn does_not_mirror_conflicting_service_fields_or_other_process_roles_into_core_logs() {
    let logs = LogStore::new(Vec::new());
    for message in [
        r#"{"event":"core.archive_completed","service":"core","context":{"service":"websocket"}}"#,
        r#"{"event":"core.archive_completed","service":"websocket","context":{"service":"core"}}"#,
    ] {
        logs.append("webserver", message, false);
    }
    logs.append(
        "postgresql",
        r#"{"event":"core.archive_completed","service":"core"}"#,
        false,
    );
    assert!(
        logs.snapshot("core")["entries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn isolates_services_bounds_history_and_never_returns_supplied_secrets() {
    let logs = LogStore::new(vec!["short".into()]);
    for index in 0..310 {
        logs.append("worker", &format!("message {index}"), false);
    }
    logs.append("postgresql", "DETAIL: private SQL parameter", true);
    logs.append("webserver", "opaque short value", false);
    let workers = logs.snapshot("worker");
    assert_eq!(workers["entries"].as_array().unwrap().len(), 300);
    assert_eq!(workers["entries"][0]["message"], "message 10");
    assert!(
        !logs
            .snapshot("postgresql")
            .to_string()
            .contains("private SQL parameter")
    );
    assert!(!logs.snapshot("webserver").to_string().contains("short"));
    assert_eq!(
        logs.snapshot("core")["entries"].as_array().unwrap().len(),
        0
    );
    logs.append("worker", r#"{"level":"info","event":"core.archive_completed","context":{"service":"core"},"password":"short"}"#, false);
    let core = logs.snapshot("core");
    assert_eq!(core["entries"][0]["event"], "core.archive_completed");
    assert!(!core.to_string().contains("short"));
}

#[test]
fn recovers_a_poisoned_log_lock_without_losing_the_runtime_contract() {
    let logs = LogStore::new(Vec::new());
    let failure = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = logs.entries.lock().unwrap();
        panic!("synthetic log producer failure");
    }));
    assert!(failure.is_err());
    logs.append("worker", "Überprüfung nach Producer-Abbruch", false);
    let snapshot = logs.snapshot("worker");
    assert_eq!(snapshot["source"], "container");
    assert_eq!(
        snapshot["entries"][0]["message"],
        "Überprüfung nach Producer-Abbruch"
    );
}

#[test]
fn mirrors_structured_websocket_events_without_payloads_or_credentials() {
    let logs = LogStore::new(vec!["synthetic-secret".into()]);
    logs.append("webserver",r#"{"level":"info","event":"realtime.connection_opened","context":{"service":"websocket","userId":"private-user","payload":"private-frame"},"token":"synthetic-secret"}"#,false);
    logs.append("webserver",r#"{"level":"warn","event":"websocket.connection_closed","service":"websocket","message":"private-frame synthetic-secret"}"#,true);
    let snapshot = logs.snapshot("websocket");
    let entries = snapshot["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["event"], "realtime.connection_opened");
    assert_eq!(entries[1]["event"], "websocket.connection_closed");
    assert_eq!(entries[1]["level"], "warn");
    assert_eq!(entries[0]["message"], "realtime.connection_opened");
    assert_eq!(entries[0]["context"], json!({"service":"websocket"}));
    let serialized = snapshot.to_string();
    for private in ["private-user", "private-frame", "synthetic-secret"] {
        assert!(!serialized.contains(private));
    }
    assert_eq!(
        logs.snapshot("webserver")["entries"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(
        !logs
            .snapshot("webserver")
            .to_string()
            .contains("synthetic-secret")
    );
    assert!(
        logs.snapshot("core")["entries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn rejects_invalid_websocket_events_and_other_process_roles() {
    let logs = LogStore::new(vec!["synthetic-secret".into()]);
    for event in [
        "core.ready",
        "realtime.",
        "websocket..closed",
        "realtime.Uppercase",
        "realtime.bad\nvalue",
        "realtime.a.b.c.d.e.f.g.h.i",
        "websocket.synthetic-secret",
        &format!("realtime.{}", "a".repeat(120)),
    ] {
        let message =
            json!({"level":"info","event":event,"context":{"service":"websocket"}}).to_string();
        logs.append("webserver", &message, false);
    }
    logs.append(
        "worker",
        r#"{"event":"realtime.started","context":{"service":"websocket"}}"#,
        false,
    );
    logs.append(
        "webserver",
        r#"{"event":"realtime.started","context":{"service":"worker"}}"#,
        false,
    );
    logs.append(
        "webserver",
        r#"{"event":"realtime.started","service":"core","context":{"service":"websocket"}}"#,
        false,
    );
    logs.append(
        "webserver",
        r#"{"event":"realtime.started","service":"websocket","context":{"service":"core"}}"#,
        false,
    );
    logs.append("webserver", r#"{"event":42,"service":"websocket"}"#, false);
    logs.append("webserver", "realtime.started service=websocket", false);
    assert!(
        logs.snapshot("websocket")["entries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn websocket_history_is_independently_bounded() {
    let logs = LogStore::new(Vec::new());
    for _ in 0..310 {
        logs.append(
            "webserver",
            r#"{"level":"info","event":"realtime.connection_opened","service":"websocket"}"#,
            false,
        );
    }
    assert_eq!(
        logs.snapshot("websocket")["entries"]
            .as_array()
            .unwrap()
            .len(),
        MAX_ENTRIES
    );
    assert_eq!(
        logs.snapshot("webserver")["entries"]
            .as_array()
            .unwrap()
            .len(),
        MAX_ENTRIES
    );
    assert!(
        logs.snapshot("worker")["entries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
