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
    let context = OperationContext::new(Some(marker.clone()), None);
    context.check().unwrap();
    let poll = context.cancellation_marker.as_deref().unwrap();
    assert!(poll.next_poll_ms.load(Ordering::Relaxed) >= 25);
    poll.next_poll_ms.store(u64::MAX, Ordering::Relaxed);
    std::fs::write(&marker, b"").unwrap();
    let shared = context.clone();
    shared.check().unwrap();
    poll.next_poll_ms.store(0, Ordering::Relaxed);
    assert_eq!(shared.check().unwrap_err().code, "CORE_CANCELLED");
    std::fs::remove_file(marker).unwrap();
    assert_eq!(context.check().unwrap_err().code, "CORE_CANCELLED");
    OperationContext::cleanup().check().unwrap();
    assert_eq!(
        context.progress(serde_json::json!({})).unwrap_err().code,
        "CORE_CANCELLED"
    );
}

#[test]
fn atomic_cancellation_interrupts_a_clone_during_the_marker_poll_interval() {
    let directory = tempfile::tempdir().unwrap();
    let context = OperationContext::new(Some(directory.path().join("missing")), None);
    let poll = context.cancellation_marker.as_deref().unwrap();
    poll.next_poll_ms.store(u64::MAX, Ordering::Relaxed);
    context.check().unwrap();
    context.clone().cancel();
    assert_eq!(context.check().unwrap_err().code, "CORE_CANCELLED");
}

#[test]
fn immediate_cancellation_check_bypasses_and_refreshes_the_poll_deadline() {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("cancel");
    let context = OperationContext::new(Some(marker.clone()), None);
    let poll = context.cancellation_marker.as_deref().unwrap();
    poll.next_poll_ms.store(u64::MAX, Ordering::Relaxed);

    context.check_now().unwrap();
    assert!(
        (CancellationMarker::POLL_INTERVAL_MS..u64::MAX)
            .contains(&poll.next_poll_ms.load(Ordering::Relaxed))
    );
    poll.next_poll_ms.store(u64::MAX, Ordering::Relaxed);
    std::fs::write(&marker, b"").unwrap();
    context.check().unwrap();
    assert_eq!(context.check_now().unwrap_err().code, "CORE_CANCELLED");

    std::fs::remove_file(marker).unwrap();
    assert_eq!(context.clone().check().unwrap_err().code, "CORE_CANCELLED");
}

#[test]
fn pending_cancellation_marker_prevents_replacing_a_private_file() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("private");
    let file = root.join("payload");
    let request = serde_json::json!({
        "operation": "writeFile",
        "rootDirectory": root,
        "filePath": file,
    });
    crate::storage::execute_worker(&request, Some(b"original"), &OperationContext::cleanup())
        .unwrap();

    let marker = directory.path().join("cancel");
    std::fs::write(&marker, b"").unwrap();
    let context = OperationContext::new(Some(marker), None);
    let poll = context.cancellation_marker.as_deref().unwrap();
    poll.next_poll_ms.store(u64::MAX, Ordering::Relaxed);

    let result = crate::storage::execute_worker(&request, Some(b"replacement"), &context);
    let Err(error) = result else {
        panic!("A pending cancellation marker must block publication.");
    };

    assert_eq!(error.code, "CORE_CANCELLED");
    assert_eq!(std::fs::read(file).unwrap(), b"original");
    assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
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
