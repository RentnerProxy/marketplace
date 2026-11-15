use super::*;

#[test]
fn errors_preserve_public_codes_without_leaking_os_paths_or_json_values() {
    for (kind, expected) in [
        (io::ErrorKind::NotFound, "ENOENT"),
        (io::ErrorKind::AlreadyExists, "EEXIST"),
        (io::ErrorKind::PermissionDenied, "EACCES"),
        (io::ErrorKind::Interrupted, "CORE_CANCELLED"),
        (io::ErrorKind::Other, "CORE_IO_ERROR"),
    ] {
        let error: CoreError = io::Error::new(kind, "private/path/synthetic-secret").into();
        assert_eq!(error.code, expected);
        assert!(!error.to_string().contains("synthetic-secret"));
        assert!(!error.to_string().contains("private/path"));
    }
    let native = CoreError::io(io::Error::from_raw_os_error(2));
    assert!(native.message.contains("OS-Fehler: 2"));
    let malformed = serde_json::from_str::<Value>("synthetic-secret").unwrap_err();
    let public: CoreError = malformed.into();
    assert_eq!(public.code, "CORE_INVALID_REQUEST");
    assert!(!public.message.contains("synthetic-secret"));
}

#[test]
fn cancellation_is_shared_but_cleanup_ignores_an_existing_marker_and_abort() {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("cancel");
    let context = OperationContext {
        cancellation_path: Some(marker.clone()),
        ..OperationContext::cleanup()
    };
    context.check().unwrap();
    std::fs::write(marker, b"").unwrap();
    assert_eq!(context.check().unwrap_err().code, "CORE_CANCELLED");
    let shared = context.clone();
    shared.cancel();
    assert!(context.cancelled.load(Ordering::Acquire));
    OperationContext::cleanup().check().unwrap();
    assert_eq!(
        context.progress(serde_json::json!({})).unwrap_err().code,
        "CORE_CANCELLED"
    );
}

#[test]
fn progress_throttles_repeats_but_always_publishes_phase_changes_and_completion() {
    let context = OperationContext::cleanup();
    context
        .progress(serde_json::json!({"phase":"copying","processedBytes":1,"totalBytes":3}))
        .unwrap();
    let first = context.last_progress.lock().unwrap().clone().unwrap();
    context
        .progress(serde_json::json!({"phase":"copying","processedBytes":2,"totalBytes":3}))
        .unwrap();
    assert_eq!(
        context.last_progress.lock().unwrap().as_ref().unwrap().1,
        first.1
    );
    context
        .progress(serde_json::json!({"phase":"copying","processedBytes":3,"totalBytes":3}))
        .unwrap();
    assert!(context.last_progress.lock().unwrap().as_ref().unwrap().1 >= first.1);
    context
        .progress(serde_json::json!({"phase":"syncing"}))
        .unwrap();
    assert_eq!(
        context.last_progress.lock().unwrap().as_ref().unwrap().0,
        "syncing"
    );
    context.progress(serde_json::json!({})).unwrap();
    assert_eq!(
        context.last_progress.lock().unwrap().as_ref().unwrap().0,
        ""
    );
}

#[test]
fn poisoned_progress_state_returns_a_structured_failure() {
    let context = OperationContext::cleanup();
    let shared = context.clone();
    assert!(
        std::thread::spawn(move || {
            let _guard = shared.last_progress.lock().unwrap();
            panic!("synthetic progress fault");
        })
        .join()
        .is_err()
    );
    assert_eq!(
        context.progress(serde_json::json!({})).unwrap_err().code,
        "CORE_PROGRESS_ERROR"
    );
}
