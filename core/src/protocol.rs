use serde::Serialize;
use serde_json::Value;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

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
    cancellation_path: Option<PathBuf>,
    last_progress: Arc<Mutex<Option<(String, Instant)>>>,
    request_id: Option<u64>,
}

impl Default for OperationContext {
    fn default() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            cancellation_path: std::env::var_os("MARKETPLACE_CORE_CANCEL_FILE").map(PathBuf::from),
            last_progress: Arc::new(Mutex::new(None)),
            request_id: None,
        }
    }
}

impl OperationContext {
    pub fn cleanup() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            cancellation_path: None,
            last_progress: Arc::new(Mutex::new(None)),
            request_id: None,
        }
    }

    pub fn check(&self) -> CoreResult<()> {
        if self.cancelled.load(Ordering::Acquire)
            || self
                .cancellation_path
                .as_ref()
                .is_some_and(|path| path.exists())
        {
            Err(CoreError::new(
                "CORE_CANCELLED",
                "Der Core-Auftrag wurde abgebrochen.",
            ))
        } else {
            Ok(())
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
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
    let mut output = io::stdout().lock();
    serde_json::to_writer(&mut output, value)?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
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
        let mut input = Vec::new();
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
