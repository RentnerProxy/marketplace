//! Private, serial stdin/stdout workers. A framing failure ends the stream;
//! there is no retry or resynchronization after potentially mutating work.
use super::{CoreError, CoreResult, OperationContext, json_line};
use serde::Deserialize;
use serde_json::{Value, json, value::RawValue};
use std::io::{self, BufRead, Read, Write};
use std::path::Path;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use zeroize::{Zeroize, Zeroizing};

const MAX_REQUEST: usize = 64 * 1024 * 1024;
const MAX_HEADER: usize = MAX_REQUEST + 64 * 1024;
const MAX_BINARY: u64 = 8 * 1024 * 1024;
const READ_BUFFER_BYTES: usize = 64 * 1024;

/// Owned terminal data, erased after its complete publication or on failure.
pub enum WorkerResponse {
    Json(Value),
    VersionedBinary {
        bytes: Zeroizing<Vec<u8>>,
        version: String,
    },
}

impl Drop for WorkerResponse {
    fn drop(&mut self) {
        if let Self::Json(value) = self {
            wipe(value);
        }
    }
}

pub(crate) fn branding_lengths(request: &Value, total: u64) -> CoreResult<[usize; 3]> {
    if request["operation"] != "brandingPublish"
        || ["largeBase64", "smallBase64", "faviconBase64"]
            .iter()
            .any(|key| request.get(key).is_some())
    {
        return Err(invalid());
    }
    let values = request["binaryLengths"].as_array().ok_or_else(invalid)?;
    if values.len() != 3 || total > 3 * MAX_BINARY {
        return Err(invalid());
    }
    let mut lengths = [0; 3];
    let mut sum = 0_u64;
    for (target, value) in lengths.iter_mut().zip(values) {
        let length = value
            .as_u64()
            .filter(|length| (1..=MAX_BINARY).contains(length))
            .ok_or_else(invalid)?;
        sum = sum.checked_add(length).ok_or_else(invalid)?;
        *target = usize::try_from(length).map_err(|_| invalid())?;
    }
    if total != sum {
        return Err(invalid());
    }
    Ok(lengths)
}

/// Unlike BufReader, consuming input erases its retained read-ahead copy.
struct WipingReader<R> {
    source: R,
    bytes: Zeroizing<Vec<u8>>,
    start: usize,
    end: usize,
}

impl<R: Read> WipingReader<R> {
    fn new(source: R) -> Self {
        Self {
            source,
            bytes: Zeroizing::new(vec![0; READ_BUFFER_BYTES]),
            start: 0,
            end: 0,
        }
    }
}

impl<R: Read> Read for WipingReader<R> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.start == self.end && output.len() >= self.bytes.len() {
            return self.source.read(output);
        }
        let available = self.fill_buf()?;
        let length = available.len().min(output.len());
        output[..length].copy_from_slice(&available[..length]);
        self.consume(length);
        Ok(length)
    }
}

impl<R: Read> BufRead for WipingReader<R> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        if self.start == self.end {
            self.start = 0;
            self.end = self.source.read(&mut self.bytes)?;
        }
        Ok(&self.bytes[self.start..self.end])
    }

    fn consume(&mut self, amount: usize) {
        let end = self.start + amount.min(self.end - self.start);
        self.bytes[self.start..end].zeroize();
        self.start = end;
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RequestHeader<'a> {
    request_id: u64,
    cancellation_path: String,
    #[serde(borrow)]
    request: &'a RawValue,
    #[serde(default, deserialize_with = "binary_length")]
    binary_bytes: Option<u64>,
}

impl Drop for RequestHeader<'_> {
    fn drop(&mut self) {
        self.cancellation_path.zeroize();
    }
}

struct Request {
    request_id: u64,
    cancellation_path: String,
    request: Value,
    binary_bytes: Option<u64>,
}

// An absent binaryBytes is distinct from zero; explicit null is malformed.
fn binary_length<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u64>, D::Error> {
    u64::deserialize(deserializer).map(Some)
}

pub(crate) fn wipe(value: &mut Value) {
    match value {
        Value::String(text) => text.zeroize(),
        Value::Array(values) => values.iter_mut().for_each(wipe),
        Value::Object(values) => {
            for (mut key, mut value) in std::mem::take(values) {
                key.zeroize();
                wipe(&mut value);
            }
        }
        _ => (),
    }
}

impl Drop for Request {
    fn drop(&mut self) {
        self.cancellation_path.zeroize();
        wipe(&mut self.request);
    }
}

fn invalid() -> CoreError {
    CoreError::new(
        "CORE_PROTOCOL_ERROR",
        "Der Core-Worker hat eine ungültige Anfrage erhalten.",
    )
}

fn read_request(
    input: &mut impl BufRead,
    expected: u64,
    binary_allowed: bool,
) -> CoreResult<Option<Request>> {
    let mut header = Zeroizing::new(Vec::new());
    let length = input
        .take((MAX_HEADER + 1) as u64)
        .read_until(b'\n', &mut header)?;
    if length == 0 {
        return Ok(None);
    }
    if length > MAX_HEADER || header.last() != Some(&b'\n') {
        return Err(invalid());
    }
    let mut header: RequestHeader<'_> = serde_json::from_slice(&header)?;
    let raw = header.request.get();
    if header.request_id != expected
        || !Path::new(&header.cancellation_path).is_absolute()
        || header.cancellation_path.contains('\0')
        || !raw.starts_with('{')
        || raw.len() > MAX_REQUEST
    {
        return Err(invalid());
    }
    let request_value = serde_json::from_str(raw)?;
    let request = Request {
        request_id: header.request_id,
        cancellation_path: std::mem::take(&mut header.cancellation_path),
        request: request_value,
        binary_bytes: header.binary_bytes,
    };
    match request.binary_bytes {
        Some(_) if !binary_allowed => return Err(invalid()),
        Some(length) if request.request["operation"] == "writeFile" => {
            if length > MAX_BINARY
                || request.request.get("dataBase64").is_some()
                || request.request.get("binaryLengths").is_some()
            {
                return Err(invalid());
            }
        }
        Some(length) => {
            branding_lengths(&request.request, length)?;
        }
        None if request.request.get("binaryLengths").is_some() => return Err(invalid()),
        None => (),
    }
    Ok(Some(request))
}

#[derive(Default)]
struct Signals {
    stopped: AtomicBool,
    active: Mutex<Option<OperationContext>>,
}

impl Signals {
    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        match self.active.lock() {
            Ok(active) => match active.as_ref() {
                Some(context) => context.cancel(),
                None => std::process::exit(0),
            },
            Err(_) => std::process::exit(1),
        }
    }
}

fn worker_session(
    input: &mut impl BufRead,
    signals: &Signals,
    binary_allowed: bool,
    handler: impl Fn(&Value, Option<&[u8]>, &OperationContext) -> CoreResult<WorkerResponse>,
    mut output: impl FnMut(&Value, Option<&[u8]>) -> CoreResult<()>,
) -> CoreResult<()> {
    output(&json!({"type":"ready","protocol":1}), None)?;
    let mut expected = 1_u64;
    while !signals.stopped.load(Ordering::Acquire) {
        let Some(request) = read_request(input, expected, binary_allowed)? else {
            return Ok(());
        };
        let context = OperationContext::new(
            Some(request.cancellation_path.clone().into()),
            Some(request.request_id),
        );
        let mut binary = request
            .binary_bytes
            .map(|length| Zeroizing::new(vec![0; length as usize]));
        if let Some(bytes) = binary.as_mut() {
            // Exact reads preserve arbitrary newlines, NULs and the next header.
            input.read_exact(bytes)?;
        }
        // Receiving a frame cannot mutate files. Until it is complete, signals
        // use the idle exit path instead of waiting for a stalled stdin writer.
        *signals.active.lock().map_err(|_| invalid())? = Some(context.clone());
        let result = context.check().and_then(|()| {
            handler(
                &request.request,
                binary.as_deref().map(Vec::as_slice),
                &context,
            )
        });
        // Binary output is a capability of this one operation, never an
        // alternative representation for arbitrary JSON results.
        let result = result.and_then(|response| match &response {
            WorkerResponse::VersionedBinary { bytes, version }
                if request.request["operation"] != "readBackgroundRepresentation"
                    || bytes.len() as u64 > MAX_BINARY
                    || version.len() != 64
                    || !version
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) =>
            {
                Err(invalid())
            }
            _ => Ok(response),
        });
        let request_id = request.request_id;
        drop(binary);
        drop(request);
        *signals.active.lock().map_err(|_| invalid())? = None;
        drop(context);
        let mut result = result;
        let mut response = match &mut result {
            Ok(WorkerResponse::Json(value)) => {
                json!({"type":"result","requestId":request_id,"result":std::mem::take(value)})
            }
            Ok(WorkerResponse::VersionedBinary { bytes, version }) => {
                json!({"type":"binaryResult","requestId":request_id,"binaryBytes":bytes.len(),"version":version})
            }
            Err(error) => json!({"type":"error","requestId":request_id,"error":error}),
        };
        let binary = match &result {
            Ok(WorkerResponse::VersionedBinary { bytes, .. }) => Some(bytes.as_slice()),
            _ => None,
        };
        let emitted = output(&response, binary);
        wipe(&mut response);
        drop(result);
        emitted?;
        expected = expected.checked_add(1).ok_or_else(invalid)?;
    }
    Ok(())
}

/// Serve serial requests until EOF, a signal or the first framing failure.
pub fn run_worker(
    handler: impl Fn(&Value, Option<&[u8]>, &OperationContext) -> CoreResult<Value>,
    binary_allowed: bool,
) {
    run_binary_worker(
        |request, binary, context| handler(request, binary, context).map(WorkerResponse::Json),
        binary_allowed,
    );
}

fn write_response(
    output: &mut impl Write,
    header: &Value,
    binary: Option<&[u8]>,
) -> CoreResult<()> {
    output.write_all(&json_line(header)?)?;
    if let Some(bytes) = binary {
        output.write_all(bytes)?;
    }
    output.flush()?;
    Ok(())
}

pub fn run_binary_worker(
    handler: impl Fn(&Value, Option<&[u8]>, &OperationContext) -> CoreResult<WorkerResponse>,
    binary_allowed: bool,
) {
    let signals = Arc::new(Signals::default());
    let cancellation = Arc::clone(&signals);
    let result = ctrlc::set_handler(move || cancellation.stop())
        .map_err(|_| invalid())
        .and_then(|()| {
            worker_session(
                &mut WipingReader::new(io::stdin().lock()),
                &signals,
                binary_allowed,
                handler,
                |header, binary| write_response(&mut io::stdout().lock(), header, binary),
            )
        });
    if result.is_err() {
        // An untrusted frame cannot safely be correlated or acknowledged.
        std::process::exit(1);
    }
}

#[cfg(test)]
#[path = "../../tests/unit/protocol_worker.rs"]
mod tests;
