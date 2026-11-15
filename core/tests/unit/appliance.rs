use super::*;

#[test]
fn native_driver_fails_closed_when_scrubbed_path_has_no_privilege_or_database_tools() {
    let directory = tempfile::tempdir().unwrap();
    let mut environment = create_environment(
        &[("POSTGRES_PASSWORD".into(), "synthetic-password".into())]
            .into_iter()
            .collect(),
        true,
    )
    .unwrap();
    environment.insert("PATH".into(), directory.path().to_str().unwrap().into());
    let stopping = AtomicBool::new(false);
    let mut driver = NativeDriver {
        environment: &environment,
        logs: Arc::new(LogStore::new(Vec::new())),
        stopping: &stopping,
        maintenance: true,
        children: Vec::new(),
    };
    assert!(driver.start(Role::Postgresql).is_err());
    assert!(!driver.probe(Role::Postgresql));
    assert!(!driver.any_exited());
    assert!(!driver.stop(true, Duration::from_millis(100)));
    assert!(!driver.stop(false, Duration::from_millis(100)));
    driver.finish();
}
