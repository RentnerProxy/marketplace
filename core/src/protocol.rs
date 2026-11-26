use serde::Serialize;
use serde_json::Value;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

mod worker;
pub(crate) use worker::branding_lengths;
pub(crate) use worker::wipe as clear_value;
pub use worker::{WorkerResponse, run_binary_worker, run_worker};

pub type CoreResult<T> = Result<T, CoreError>;

#[derive(Debug, Serialize)]
pub struct CoreError {
    pub code: String,
    pub message: String,
}

impl CoreError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn io(error: io::Error) -> Self {
        let code = match error.kind() {
            io::ErrorKind::NotFound => "ENOENT",
            io::ErrorKind::AlreadyExists => "EEXIST",
            io::ErrorKind::PermissionDenied => "EACCES",
            io::ErrorKind::Interrupted => "CORE_CANCELLED",
            _ => "CORE_IO_ERROR",
        };
        let message = error.raw_os_error().map_or_else(
            || "Die Dateioperation konnte nicht abgeschlossen werden.".to_owned(),
            |number| {
                format!(
                    "Die Dateioperation konnte nicht abgeschlossen werden. OS-Fehler: {number}."
                )
            },
        );
        Self::new(code, message)
    }
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CoreError {}

impl From<io::Error> for CoreError {
    fn from(error: io::Error) -> Self {
        Self::io(error)
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(_: serde_json::Error) -> Self {
        Self::new("CORE_INVALID_REQUEST", "Die Core-Anfrage ist ungültig.")
    }
}

#[derive(Clone)]
pub struct OperationContext {
    cancelled: Arc<AtomicBool>,
    cancellation_marker: Option<Arc<CancellationMarker>>,
    last_progress: Arc<Mutex<Option<(String, Instant)>>>,
    request_id: Option<u64>,
}

struct CancellationMarker {
    path: PathBuf,
    started: Instant,
    next_poll_ms: AtomicU64,
}

impl CancellationMarker {
    const POLL_INTERVAL_MS: u64 = 25;

    fn new(path: PathBuf) -> Self {
        Self {
            path,
            started: Instant::now(),
            next_poll_ms: AtomicU64::new(0),
        }
    }

    fn poll(&self) -> bool {
        let now = self.started.elapsed().as_millis() as u64;
        let next = self.next_poll_ms.load(Ordering::Relaxed);
        now >= next
            && self
                .next_poll_ms
                .compare_exchange(
                    next,
                    now + Self::POLL_INTERVAL_MS,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                )
                .is_ok()
            && self.path.exists()
    }

    fn poll_now(&self) -> bool {
        let now = self.started.elapsed().as_millis() as u64;
        self.next_poll_ms
            .store(now + Self::POLL_INTERVAL_MS, Ordering::Relaxed);
        self.path.exists()
    }
}

impl Default for OperationContext {
    fn default() -> Self {
        Self::new(
            std::env::var_os("MARKETPLACE_CORE_CANCEL_FILE").map(PathBuf::from),
            None,
        )
    }
}

impl OperationContext {
    fn new(cancellation_path: Option<PathBuf>, request_id: Option<u64>) -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            cancellation_marker: cancellation_path
                .map(|path| Arc::new(CancellationMarker::new(path))),
            last_progress: Arc::new(Mutex::new(None)),
            request_id,
        }
    }

    pub fn cleanup() -> Self {
        Self::new(None, None)
    }

    pub fn check(&self) -> CoreResult<()> {
        self.check_cancellation(CancellationMarker::poll)
    }

    /// Check for cancellation immediately before committing or finishing work.
    pub fn check_now(&self) -> CoreResult<()> {
        self.check_cancellation(CancellationMarker::poll_now)
    }

    fn check_cancellation(&self, poll: impl FnOnce(&CancellationMarker) -> bool) -> CoreResult<()> {
        if self.cancelled.load(Ordering::Relaxed)
            || self.cancellation_marker.as_deref().is_some_and(poll)
        {
            self.cancel();
            Err(CoreError::new(
                "CORE_CANCELLED",
                "Der Core-Auftrag wurde abgebrochen.",
            ))
        } else {
            Ok(())
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn progress(&self, progress: Value) -> CoreResult<()> {
        self.check()?;
        let phase = progress
            .get("phase")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let complete = progress
            .get("totalBytes")
            .and_then(Value::as_u64)
            .is_some_and(|total| {
                total > 0
                    && progress
                        .get("processedBytes")
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                        >= total
            });
        let mut last = self.last_progress.lock().map_err(|_| {
            CoreError::new(
                "CORE_PROGRESS_ERROR",
                "Der Core-Fortschritt konnte nicht bestätigt werden.",
            )
        })?;
        if let Some((last_phase, at)) = last.as_ref()
            && phase == last_phase
            && !complete
            && at.elapsed() < Duration::from_millis(500)
        {
            return Ok(());
        }
        *last = Some((phase.to_owned(), Instant::now()));
        let mut response = serde_json::json!({ "type": "progress", "progress": progress });
        if let Some(request_id) = self.request_id {
            response["requestId"] = request_id.into();
        }
        emit(&response)
    }
}

pub fn emit(value: &Value) -> CoreResult<()> {
    let line = json_line(value)?;
    let mut output = io::stdout().lock();
    output.write_all(&line)?;
    output.flush()?;
    Ok(())
}

fn json_line(value: &Value) -> CoreResult<Zeroizing<Vec<u8>>> {
    let mut line = Zeroizing::new(Vec::with_capacity(1024));
    serde_json::to_writer(&mut *line, value)?;
    line.push(b'\n');
    Ok(line)
}

pub fn run_command(handler: impl FnOnce(Value, &OperationContext) -> CoreResult<Value>) {
    let context = OperationContext::default();
    let cancellation = context.clone();
    if ctrlc::set_handler(move || cancellation.cancel()).is_err() {
        let _ = emit(
            &serde_json::json!({ "type": "error", "error": CoreError::new("CORE_SIGNAL_ERROR", "Die Core-Signalbehandlung ist nicht verfügbar.") }),
        );
        std::process::exit(1);
    }
    let result = (|| {
        const MAXIMUM_REQUEST_BYTES: u64 = 64 * 1024 * 1024;
        let mut input = Zeroizing::new(Vec::new());
        io::stdin()
            .take(MAXIMUM_REQUEST_BYTES + 1)
            .read_to_end(&mut input)?;
        if input.len() as u64 > MAXIMUM_REQUEST_BYTES {
            return Err(CoreError::new(
                "CORE_REQUEST_TOO_LARGE",
                "Die Core-Anfrage überschreitet das Größenlimit.",
            ));
        }
        context.check()?;
        handler(serde_json::from_slice(&input)?, &context)
    })();
    match result {
        Ok(result) => {
            if emit(&serde_json::json!({ "type": "result", "result": result })).is_err() {
                std::process::exit(1);
            }
        }
        Err(error) => {
            let _ = emit(&serde_json::json!({ "type": "error", "error": error }));
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
#[path = "../tests/unit/protocol.rs"]
mod tests;
