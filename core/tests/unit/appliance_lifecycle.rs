use super::*;
struct Fixture<'a> {
    events: Vec<String>,
    stopping: &'a AtomicBool,
    failure: &'static str,
    checks: usize,
    maintenance: bool,
}
impl Driver for Fixture<'_> {
    fn prepare(&mut self) -> Result<()> {
        self.events.push("prepare".into());
        if self.failure == "prepare" {
            Err("fixture_prepare_failed")
        } else {
            Ok(())
        }
    }
    fn start(&mut self, role: Role) -> Result<()> {
        self.events.push(format!("start:{}", role.name()));
        if self.failure == role.name() {
            Err("fixture_start_failed")
        } else {
            Ok(())
        }
    }
    fn probe(&mut self, role: Role) -> bool {
        self.events.push(format!("probe:{}", role.name()));
        if self.failure == "cancel" {
            self.stopping.store(true, Ordering::SeqCst);
        }
        self.failure != "readiness"
    }
    fn any_exited(&mut self) -> bool {
        self.checks += 1;
        if self.failure == "early_exit" {
            return true;
        }
        if self.checks > if self.maintenance { 1 } else { 4 } {
            if self.failure == "child_exit" {
                return true;
            }
            self.stopping.store(true, Ordering::SeqCst);
        }
        false
    }
    fn initialize_database(&mut self) -> Result<()> {
        self.events.push("database".into());
        if self.failure == "database" {
            Err("fixture_database_failed")
        } else {
            Ok(())
        }
    }
    fn stop(&mut self, consumers: bool, _: Duration) -> bool {
        self.events.push(format!("stop:{consumers}"));
        self.failure == "drain"
    }
    fn finish(&mut self) {
        self.events.push("finish".into());
    }
}
fn run(failure: &'static str, maintenance: bool, standalone: bool) -> (i32, Vec<String>) {
    let stopping = AtomicBool::new(failure == "already_stopping");
    let ready = AtomicBool::new(false);
    let logs = LogStore::new(Vec::new());
    let mut fixture = Fixture {
        events: Vec::new(),
        stopping: &stopping,
        failure,
        checks: 0,
        maintenance,
    };
    let code = supervise(
        &mut fixture,
        &logs,
        &ready,
        &stopping,
        maintenance,
        standalone,
        Timing {
            startup: Duration::ZERO,
            consumer_shutdown: Duration::from_secs(1),
            service_shutdown: Duration::from_secs(1),
            probe_interval: Duration::ZERO,
        },
    );
    assert!(!ready.load(Ordering::SeqCst));
    assert_eq!(
        &fixture.events[fixture.events.len() - 3..],
        ["stop:true", "stop:false", "finish"]
    );
    (code, fixture.events)
}
#[test]
fn ordered_startup_initializes_database_before_valkey_and_drains_consumers_first() {
    let (code, events) = run("", false, false);
    assert_eq!(code, 0);
    assert_eq!(
        &events[..10],
        [
            "prepare",
            "start:postgresql",
            "probe:postgresql",
            "database",
            "start:valkey",
            "probe:valkey",
            "start:webserver",
            "probe:webserver",
            "start:worker",
            "probe:worker"
        ]
    );
    let (code, events) = run("", true, false);
    assert_eq!(code, 0);
    assert!(
        !events.iter().any(|event| event == "database"
            || event.contains("worker")
            || event.contains("valkey"))
    );
    assert_eq!(run("", false, true).0, 0);
}
#[test]
fn startup_exit_readiness_and_drain_failures_propagate_and_always_cleanup() {
    for failure in [
        "prepare",
        "postgresql",
        "valkey",
        "webserver",
        "worker",
        "database",
        "early_exit",
        "readiness",
        "child_exit",
        "drain",
    ] {
        assert_eq!(run(failure, false, false).0, 1, "{failure}");
    }
    assert_eq!(run("cancel", false, false).0, 0);
    assert_eq!(run("already_stopping", false, false).0, 0);
}
