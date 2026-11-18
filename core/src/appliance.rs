//! Native owner of the bundled appliance lifecycle and loopback telemetry.
mod environment;
mod lifecycle;
mod logs;
mod process;
mod storage;
mod telemetry;

use environment::Environment;
use lifecycle::{Driver, Timing};
use logs::LogStore;
use process::{ManagedChild, Role};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

pub use environment::create_environment;
pub use logs::{LogEntry, redact_line};
pub use storage::assert_directory;

type Result<T> = std::result::Result<T, &'static str>;
const CONSUMER_SHUTDOWN: Duration = Duration::from_secs(4 * 3600 + 5 * 60);
const SERVICE_SHUTDOWN: Duration = Duration::from_secs(30);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(300);

struct NativeDriver<'a> {
    environment: &'a Environment,
    logs: Arc<LogStore>,
    stopping: &'a AtomicBool,
    maintenance: bool,
    children: Vec<ManagedChild>,
}
impl Driver for NativeDriver<'_> {
    fn prepare(&mut self) -> Result<()> {
        storage::prepare(self.environment, self.maintenance, self.stopping)
    }
    fn start(&mut self, role: Role) -> Result<()> {
        self.children.push(ManagedChild::start(
            role,
            self.environment,
            self.logs.clone(),
        )?);
        Ok(())
    }
    fn probe(&mut self, role: Role) -> bool {
        process::probe(role, self.environment)
    }
    fn any_exited(&mut self) -> bool {
        self.children.iter_mut().any(ManagedChild::exited)
    }
    fn initialize_database(&mut self) -> Result<()> {
        storage::initialize_database(self.environment, self.stopping)
    }
    fn stop(&mut self, consumers: bool, timeout: Duration) -> bool {
        process::stop_children(&mut self.children, consumers, timeout)
    }
    fn finish(&mut self) {
        for child in self.children.drain(..) {
            child.finish();
        }
    }
}

pub fn run(mode: &str) -> Result<i32> {
    if mode == "healthcheck" {
        return Ok(
            if process::http_probe_with_timeout(3004, "/health", Duration::from_secs(12)) {
                0
            } else {
                1
            },
        );
    }
    if !matches!(mode, "start" | "maintenance" | "serve") {
        return Err("appliance_command_invalid");
    }
    let standalone = mode == "serve";
    let maintenance = mode == "maintenance";
    if !standalone {
        storage::require_root()?;
    }
    let environment = if standalone {
        Environment::new()
    } else {
        environment::load_environment(maintenance)?
    };
    let logs = Arc::new(LogStore::new(
        [
            "POSTGRES_PASSWORD",
            "AUTH_ENCRYPTION_KEY",
            "SMTP_PASSWORD",
            "MARKETPLACE_CANDIDATE_GITHUB_TOKEN",
        ]
        .into_iter()
        .filter_map(|key| environment.get(key).cloned())
        .collect(),
    ));
    let stopping = Arc::new(AtomicBool::new(false));
    let signal = stopping.clone();
    ctrlc::set_handler(move || {
        signal.store(true, Ordering::SeqCst);
    })
    .map_err(|_| "appliance_signal_handler_failed")?;
    let ready = Arc::new(AtomicBool::new(standalone));
    logs.event("core.started", "info", "Rust Core läuft");
    let runtime = telemetry::start(
        logs.clone(),
        ready.clone(),
        stopping.clone(),
        environment.clone(),
        maintenance,
        standalone,
    )?;
    let mut driver = NativeDriver {
        environment: &environment,
        logs: logs.clone(),
        stopping: &stopping,
        maintenance,
        children: Vec::new(),
    };
    let code = lifecycle::supervise(
        &mut driver,
        &logs,
        &ready,
        &stopping,
        maintenance,
        standalone,
        Timing {
            startup: STARTUP_TIMEOUT,
            consumer_shutdown: CONSUMER_SHUTDOWN,
            service_shutdown: SERVICE_SHUTDOWN,
            probe_interval: Duration::from_millis(500),
        },
    );
    runtime.stop();
    Ok(code)
}

#[cfg(all(test, unix))]
#[path = "../tests/unit/appliance.rs"]
mod tests;
