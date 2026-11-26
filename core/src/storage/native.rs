//! Request admission for the in-process storage transport.
use super::{execute_ref, files::MAX_IMAGE};
use crate::protocol::{CoreError, CoreResult, OperationContext, WorkerResponse, clear_value};
use serde_json::Value;

pub const MAX_NATIVE_REQUEST_BYTES: usize = 64 * 1024;
pub const MAX_NATIVE_BINARY_BYTES: usize = 3 * MAX_IMAGE as usize;
const MAX_NATIVE_BATCH: usize = 32;

struct Request(Value);

impl Drop for Request {
    fn drop(&mut self) {
        clear_value(&mut self.0);
    }
}

fn unsupported() -> CoreError {
    CoreError::new(
        "CORE_INVALID_OPERATION",
        "Die Operation ist über die native Storage-Schnittstelle nicht verfügbar.",
    )
}

/// Execute the operations safe for the synchronous native transport.
pub fn execute_native(json: &[u8], binary: Option<&[u8]>) -> CoreResult<WorkerResponse> {
    if json.len() > MAX_NATIVE_REQUEST_BYTES
        || binary.is_some_and(|bytes| bytes.len() > MAX_NATIVE_BINARY_BYTES)
    {
        return Err(super::invalid());
    }
    let request = Request(serde_json::from_slice(json)?);
    let request = &request.0;
    if binary.is_some() || request.get("binaryLengths").is_some() {
        return Err(unsupported());
    }
    // Inputs that require a cancellation marker or caller-specific environment
    // run through the subprocess transport. The host environment is untouched.
    let context = OperationContext::cleanup();
    match request["operation"].as_str() {
        Some("restoreStateGet") => {}
        Some("statBackground")
            if request.get("legacyRoot").is_none() && request.get("legacyPath").is_none() => {}
        Some("capacity")
            if request["requests"].as_array().is_some_and(|requests| {
                requests.len() <= MAX_NATIVE_BATCH
                    && requests
                        .iter()
                        .all(|request| request["sourcePaths"].as_array().is_some_and(Vec::is_empty))
            }) => {}
        _ => return Err(unsupported()),
    }
    execute_ref(request, &context).map(WorkerResponse::Json)
}
