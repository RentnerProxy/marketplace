//! Private C ABI for synchronous storage requests. The caller owns input bytes
//! until execution returns. Each result stays valid until its paired free call.
#[cfg(panic = "abort")]
compile_error!("The storage FFI library requires panic unwinding. Use --profile ffi.");

mod output;

use marketplace_core::{
    protocol::{CoreError, CoreResult, WorkerResponse},
    storage::{MAX_NATIVE_REQUEST_BYTES, execute_native},
};
pub use output::StorageOutput;
use std::{
    panic::{UnwindSafe, catch_unwind},
    ptr, slice,
};
use zeroize::Zeroize;

#[unsafe(no_mangle)]
pub extern "C" fn marketplace_storage_abi_version() -> u32 {
    2
}

fn invalid_input() -> CoreError {
    CoreError::new(
        "CORE_PROTOCOL_ERROR",
        "Die native Storage-Anfrage enthält ungültige Puffergrenzen.",
    )
}

fn checked_length(pointer: *const u8, length: u64, limit: usize) -> CoreResult<usize> {
    let length = usize::try_from(length).map_err(|_| invalid_input())?;
    if length > limit
        || length > isize::MAX as usize
        || (length != 0 && (pointer.is_null() || pointer.addr().checked_add(length).is_none()))
    {
        return Err(invalid_input());
    }
    Ok(length)
}

fn contain_panic(
    operation: impl FnOnce() -> CoreResult<WorkerResponse> + UnwindSafe,
) -> StorageOutput {
    match catch_unwind(|| StorageOutput::from_result(operation())) {
        Ok(output) => output,
        Err(payload) => {
            // A custom panic payload can itself panic on drop. Drop only known
            // payload types here so unwinding cannot cross the foreign boundary.
            match payload.downcast::<String>() {
                Ok(mut message) => message.zeroize(),
                Err(payload) => {
                    if let Err(payload) = payload.downcast::<&'static str>() {
                        std::mem::forget(payload);
                    }
                }
            }
            StorageOutput::uncertain()
        }
    }
}

/// Execute a UTF-8 JSON metadata request and return a Rust-owned result.
/// Pass a null binary pointer, zero binary length and `has_binary` set to 0.
///
/// # Safety
/// For an accepted, nonzero length, `json` must point to initialized, readable
/// bytes in a single allocation. The caller must keep those bytes alive and
/// immutable until the call returns.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn marketplace_storage_execute(
    json: *const u8,
    json_length: u64,
    binary: *const u8,
    binary_length: u64,
    has_binary: u8,
) -> *mut StorageOutput {
    let output = contain_panic(|| {
        let json_length = checked_length(json, json_length, MAX_NATIVE_REQUEST_BYTES)?;
        if json_length == 0 || has_binary != 0 || binary_length != 0 || !binary.is_null() {
            return Err(invalid_input());
        }
        // SAFETY: bounds and nullability were checked above. The caller
        // guarantees the readable buffer for this call.
        let json = unsafe { slice::from_raw_parts(json, json_length) };
        execute_native(json, None)
    });
    Box::into_raw(Box::new(output))
}

/// Return the borrowed JSON response pointer, or null for a null handle.
///
/// # Safety
/// Pass a live result from this library or null. The caller may only read the
/// returned bytes and must finish reading before freeing the result.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn marketplace_storage_output_json(
    output: *const StorageOutput,
) -> *const u8 {
    // SAFETY: the caller keeps a non-null result alive for the call.
    unsafe { output.as_ref() }.map_or(ptr::null(), |output| output.json().as_ptr())
}

/// Return the JSON response length, or zero for a null handle.
///
/// # Safety
/// Pass a live result from this library or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn marketplace_storage_output_json_len(output: *const StorageOutput) -> u64 {
    // SAFETY: the caller keeps a non-null result alive for the call.
    unsafe { output.as_ref() }.map_or(0, |output| output.json().len() as u64)
}

/// Erase and free the result with its original allocator. Null is a no-op.
///
/// # Safety
/// A non-null handle must come from this library and may be freed only once,
/// after all callers have finished using the result and its borrowed views.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn marketplace_storage_output_free(output: *mut StorageOutput) {
    if !output.is_null() {
        // SAFETY: the caller transfers ownership of this exact allocation once.
        drop(unsafe { Box::from_raw(output) });
    }
}

#[cfg(test)]
#[path = "../tests/unit/panic.rs"]
mod tests;

#[cfg(test)]
#[path = "../tests/unit/storage_abi.rs"]
mod abi_tests;
