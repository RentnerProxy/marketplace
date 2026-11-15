//! A restore owns one private stdin/stdout session, never a public RPC listener.
use super::restore_journal::JournalSession;
use crate::protocol::{CoreError, CoreResult, OperationContext, emit};
use serde_json::{Value, json};
use std::io::{self, BufRead, Read};
use zeroize::{Zeroize, Zeroizing};

const MAX_REQUEST_BYTES: u64 = 64 * 1024;
const MAX_REQUESTS: usize = 32;

fn invalid() -> CoreError {
    CoreError::new(
        "CORE_PROTOCOL_ERROR",
        "Die Core-Sitzung hat eine ungültige Anfrage erhalten.",
    )
}

fn read_request(input: &mut impl BufRead, context: &OperationContext) -> CoreResult<Value> {
    context.check()?;
    let mut bytes = Zeroizing::new(Vec::new());
    let length = input
        .take(MAX_REQUEST_BYTES + 1)
        .read_until(b'\n', &mut bytes)?;
    if length as u64 > MAX_REQUEST_BYTES {
        return Err(CoreError::new(
            "CORE_REQUEST_TOO_LARGE",
            "Die Core-Anfrage überschreitet das Größenlimit.",
        ));
    }
    if length == 0 || bytes.last() != Some(&b'\n') {
        return Err(invalid());
    }
    context.check()?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn session(context: &OperationContext, request_id: &mut u64) -> CoreResult<()> {
    let mut input = io::stdin().lock();
    let mut start = read_request(&mut input, context)?;
    let created = if start["operation"] == "journalStart"
        && start["requestId"].as_u64() == Some(*request_id)
    {
        JournalSession::create(&start, context)
    } else {
        Err(invalid())
    };
    // The key is only transported in stdin. Erase both the parsed copy and the
    // zeroizing input buffer instead of retaining it throughout the restore.
    if let Some(Value::String(key)) = start.get_mut("masterKeyBase64") {
        key.zeroize();
    }
    let mut journal = created?;
    drop(start);
    emit(&json!({"type":"result","requestId":*request_id,"result":{"ok":true}}))?;
    for _ in 1..MAX_REQUESTS {
        *request_id += 1;
        let request = read_request(&mut input, context)?;
        if request["requestId"].as_u64() != Some(*request_id) {
            return Err(invalid());
        }
        match request["operation"].as_str() {
            Some("journalAppend")
                if request.as_object().is_some_and(|fields| fields.len() == 3) =>
            {
                let event = request["event"].as_str().ok_or_else(invalid)?;
                let result = journal.append(event, context)?;
                emit(&json!({"type":"result","requestId":*request_id,"result":result}))?;
            }
            Some("journalClose") if request.as_object().is_some_and(|fields| fields.len() == 2) => {
                let result = journal.close(context);
                // Final content verification and sync are fallible; close the
                // descriptor and erase the derived key before confirming close.
                drop(journal);
                emit(&json!({"type":"result","requestId":*request_id,"result":result?}))?;
                return Ok(());
            }
            _ => return Err(invalid()),
        }
    }
    Err(CoreError::new(
        "CORE_REQUEST_TOO_LARGE",
        "Die Core-Sitzung hat ihr Anfragelimit überschritten.",
    ))
}

pub(crate) fn run() {
    let context = OperationContext::default();
    let cancellation = context.clone();
    let mut request_id = 1;
    let result = ctrlc::set_handler(move || cancellation.cancel())
        .map_err(|_| {
            CoreError::new(
                "CORE_SIGNAL_ERROR",
                "Die Core-Signalbehandlung ist nicht verfügbar.",
            )
        })
        .and_then(|()| session(&context, &mut request_id));
    if let Err(error) = result {
        let _ = emit(&json!({"type":"error","requestId":request_id,"error":error}));
        std::process::exit(1);
    }
}
