use super::{Result, logs::LogStore, process::Role};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub(super) trait Driver {
    fn prepare(&mut self) -> Result<()>;
    fn start(&mut self, role: Role) -> Result<()>;
    fn probe(&mut self, role: Role) -> bool;
    fn any_exited(&mut self) -> bool;
    fn initialize_database(&mut self) -> Result<()>;
    fn stop(&mut self, consumers: bool, timeout: Duration) -> bool;
    fn finish(&mut self);
}

pub(super) struct Timing {
    pub startup: Duration,
    pub consumer_shutdown: Duration,
    pub service_shutdown: Duration,
    pub probe_interval: Duration,
}

pub(super) fn supervise(
    driver: &mut impl Driver,
    logs: &LogStore,
    ready: &AtomicBool,
    stopping: &AtomicBool,
    maintenance: bool,
    standalone: bool,
    timing: Timing,
) -> i32 {
    let startup = (|| {
        if standalone {
            return Ok(());
        }
        driver.prepare()?;
        for role in Role::startup_order(maintenance) {
            if stopping.load(Ordering::SeqCst) {
                return Ok(());
            }
            driver.start(role)?;
            let deadline = Instant::now() + timing.startup;
            while !stopping.load(Ordering::SeqCst) {
                if driver.any_exited() {
                    return Err("appliance_child_failed");
                }
                if driver.probe(role) {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err("appliance_readiness_failed");
                }
                std::thread::sleep(timing.probe_interval);
            }
            if stopping.load(Ordering::SeqCst) {
                return Ok(());
            }
            logs.event("core.service_ready", "info", role.name());
            if role == Role::Postgresql && !maintenance {
                driver.initialize_database()?;
            }
        }
        ready.store(true, Ordering::SeqCst);
        logs.event("core.ready", "info", "Appliance ist bereit");
        Ok(())
    })();
    let mut failed = startup.is_err();
    if failed {
        logs.event(
            "core.startup_failed",
            "error",
            startup.err().unwrap_or("appliance_startup_failed"),
        );
    }
    while !failed && !stopping.load(Ordering::SeqCst) {
        if driver.any_exited() {
            logs.event(
                "core.child_failed",
                "error",
                "Erforderlicher Dienst wurde unerwartet beendet",
            );
            failed = true;
            break;
        }
        std::thread::sleep(timing.probe_interval);
    }
    ready.store(false, Ordering::SeqCst);
    logs.event(
        "core.stopping",
        "info",
        "Verbraucher werden vor PostgreSQL und Valkey beendet",
    );
    failed |= driver.stop(true, timing.consumer_shutdown);
    failed |= driver.stop(false, timing.service_shutdown);
    driver.finish();
    i32::from(failed)
}

#[cfg(test)]
#[path = "../../tests/unit/appliance_lifecycle.rs"]
mod tests;
