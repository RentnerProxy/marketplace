use super::*;
use std::io::Cursor;

fn session(
    input: &mut impl BufRead,
    signals: &Signals,
    binary_allowed: bool,
    handler: impl Fn(&Value, Option<&[u8]>, &OperationContext) -> CoreResult<Value>,
    mut output: impl FnMut(&Value) -> CoreResult<()>,
) -> CoreResult<()> {
    worker_session(
        input,
        signals,
        binary_allowed,
        |request, raw, context| handler(request, raw, context).map(WorkerResponse::Json),
        |header, binary| {
            assert!(binary.is_none());
            output(header)
        },
    )
}

struct ObservedReader {
    source: Cursor<Vec<u8>>,
    calls: Vec<(usize, usize)>,
    chunk: usize,
    interrupted: bool,
}

impl ObservedReader {
    fn new(bytes: Vec<u8>) -> Self {
        Self {
            source: Cursor::new(bytes),
            calls: Vec::new(),
            chunk: usize::MAX,
            interrupted: false,
        }
    }
}

impl Read for ObservedReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        self.calls.push((output.as_ptr() as usize, output.len()));
        if std::mem::take(&mut self.interrupted) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        let length = output.len().min(self.chunk);
        self.source.read(&mut output[..length])
    }
}

#[test]
fn empty_reads_do_not_touch_the_source_or_consume_read_ahead() {
    let mut reader = WipingReader::new(ObservedReader::new(b"private".to_vec()));
    reader.source.interrupted = true;
    assert_eq!(reader.read(&mut []).unwrap(), 0);
    assert!(reader.source.calls.is_empty());
    assert_eq!(
        reader.fill_buf().unwrap_err().kind(),
        io::ErrorKind::Interrupted
    );
    assert_eq!(reader.fill_buf().unwrap(), b"private");
    let calls = reader.source.calls.len();
    assert_eq!(reader.read(&mut []).unwrap(), 0);
    assert_eq!(reader.fill_buf().unwrap(), b"private");
    assert_eq!(reader.source.calls.len(), calls);
    assert_eq!(&reader.bytes[..7], b"private");
}

#[test]
fn large_reads_write_directly_to_the_destination_at_the_buffer_threshold() {
    for length in [8191, 8192, 8193, MAX_BINARY as usize] {
        let payload = vec![b'x'; length + 1];
        let mut reader = WipingReader::new(ObservedReader::new(payload));
        let mut output = Zeroizing::new(vec![0; length]);
        let destination = output.as_ptr() as usize;
        assert_eq!(reader.read(&mut output).unwrap(), length);
        assert!(output.iter().all(|byte| *byte == b'x'));
        assert_eq!(reader.source.calls.len(), 1);
        if length < 8192 {
            assert_ne!(reader.source.calls[0].0, destination);
            assert_eq!(reader.source.calls[0].1, 8192);
            assert_eq!(reader.fill_buf().unwrap(), b"x");
            assert!(reader.bytes[..length].iter().all(|byte| *byte == 0));
        } else {
            assert_eq!(reader.source.calls[0], (destination, length));
            assert!(reader.bytes.iter().all(|byte| *byte == 0));
        }
        let mut next = [0];
        reader.read_exact(&mut next).unwrap();
        assert_eq!(next, [b'x']);
        assert_eq!(reader.source.calls.len(), if length < 8192 { 1 } else { 2 });
    }
}

#[test]
fn large_reads_consume_and_wipe_read_ahead_before_bypassing_the_buffer() {
    let mut reader = WipingReader::new(ObservedReader::new(vec![b'x'; 3 * 8192]));
    assert_eq!(reader.fill_buf().unwrap().len(), 8192);
    reader.consume(8191);
    let mut output = Zeroizing::new(vec![0; 8193]);
    assert_eq!(reader.read(&mut output).unwrap(), 1);
    assert_eq!(output[0], b'x');
    assert_eq!(reader.source.calls.len(), 1);
    assert!(reader.bytes.iter().all(|byte| *byte == 0));
    assert_eq!(reader.read(&mut output).unwrap(), 8193);
    assert_eq!(reader.source.calls[1], (output.as_ptr() as usize, 8193));
    assert!(reader.bytes.iter().all(|byte| *byte == 0));
}

#[test]
fn direct_reads_preserve_short_reads_interruptions_and_eof() {
    let mut reader = WipingReader::new(ObservedReader::new(vec![b'x'; 8193]));
    reader.source.chunk = 8192;
    reader.source.interrupted = true;
    let mut output = Zeroizing::new(vec![0; 8193]);
    assert_eq!(
        reader.read(&mut output).unwrap_err().kind(),
        io::ErrorKind::Interrupted
    );
    assert_eq!(reader.read(&mut output).unwrap(), 8192);
    assert_eq!(reader.read(&mut output).unwrap(), 1);
    assert_eq!(reader.read(&mut output).unwrap(), 0);
    assert!(reader.bytes.iter().all(|byte| *byte == 0));
    assert_eq!(reader.source.calls.len(), 4);
    assert!(
        reader
            .source
            .calls
            .iter()
            .all(|call| *call == (output.as_ptr() as usize, 8193))
    );

    let mut reader = WipingReader::new(ObservedReader::new(vec![b'x'; 8193]));
    reader.source.interrupted = true;
    reader.source.chunk = 1024;
    reader.read_exact(&mut output).unwrap();
    assert!(output.iter().all(|byte| *byte == b'x'));
    assert_eq!(reader.source.source.position(), 8193);
    assert!(reader.bytes.iter().all(|byte| *byte == 0));
    assert_eq!(
        reader.read_exact(&mut [0]).unwrap_err().kind(),
        io::ErrorKind::UnexpectedEof
    );
}

fn frame(id: u64, marker: &Path, request: Value, binary: Option<u64>) -> Vec<u8> {
    let marker = if marker.is_dir() {
        marker.join("not-cancelled")
    } else {
        marker.to_owned()
    };
    let mut header = json!({"requestId":id,"cancellationPath":marker,"request":request});
    if let Some(length) = binary {
        header["binaryBytes"] = length.into();
    }
    let mut bytes = serde_json::to_vec(&header).unwrap();
    bytes.push(b'\n');
    bytes
}

#[test]
fn consumed_buffer_bytes_are_erased_and_reads_preserve_read_ahead() {
    let mut reader = WipingReader::new(Cursor::new(b"private\nnext"));
    assert_eq!(reader.fill_buf().unwrap(), b"private\nnext");
    reader.consume(8);
    assert_eq!(&reader.bytes[..8], &[0; 8]);
    let mut next = [0; 4];
    reader.read_exact(&mut next).unwrap();
    assert_eq!(&next, b"next");
    assert!(reader.bytes.iter().all(|byte| *byte == 0));
    assert!(reader.fill_buf().unwrap().is_empty());
}

#[test]
fn exact_request_span_accounts_for_nested_json_escaping_and_whitespace() {
    let header = br#"{"cancellationPath":"/request", "reque\u0073t" : { "nested": ["}\\\"",{}] }, "requestId":1}"#;
    let start = header.windows(2).position(|bytes| bytes == b"{ ").unwrap();
    let end = header
        .windows(4)
        .position(|bytes| bytes == b"] },")
        .unwrap()
        + 3;
    assert_eq!(embedded_request_size(header).unwrap(), end - start);
    assert!(embedded_request_size(b"{}").is_err());
    assert!(embedded_request_size(br#"{"request":[]} "#).is_err());
    assert!(embedded_request_size(br#"{"request":{ "a":"unterminated}"#).is_err());
    assert!(string_end(b"\"bad\\", 0).is_err());
}

#[test]
fn strict_headers_reject_invalid_ids_fields_lengths_and_payload_modes() {
    let directory = tempfile::tempdir().unwrap();
    let valid = json!({"requestId":1,"cancellationPath":directory.path().join("cancel"),"request":{"operation":"writeFile"}});
    for update in [
        json!({"requestId":0}),
        json!({"requestId":2}),
        json!({"requestId":-1}),
        json!({"requestId":1.5}),
        json!({"unknown":true}),
        json!({"cancellationPath":"relative"}),
        json!({"cancellationPath":"/bad\u{0000}path"}),
        json!({"request":[]}),
        json!({"binaryBytes":null}),
        json!({"binaryBytes":-1}),
        json!({"binaryBytes":MAX_BINARY+1}),
        json!({"binaryBytes":0,"request":{"operation":"writeFile","dataBase64":""}}),
        json!({"binaryBytes":0,"request":{"operation":"readFile"}}),
    ] {
        let mut malformed = valid.clone();
        for (key, value) in update.as_object().unwrap() {
            malformed[key] = value.clone();
        }
        let mut bytes = serde_json::to_vec(&malformed).unwrap();
        bytes.push(b'\n');
        assert!(
            read_request(&mut Cursor::new(bytes), 1, true).is_err(),
            "{update}"
        );
    }
    let zero = frame(
        1,
        directory.path(),
        json!({"operation":"writeFile"}),
        Some(0),
    );
    assert_eq!(
        read_request(&mut Cursor::new(&zero), 1, true)
            .unwrap()
            .unwrap()
            .binary_bytes,
        Some(0)
    );
    assert!(read_request(&mut Cursor::new(zero), 1, false).is_err());
    for malformed in [
        b"{\n".as_slice(),
        b"{}",
        b"{\"requestId\":1,\"requestId\":1}\n",
    ] {
        assert!(read_request(&mut Cursor::new(malformed), 1, true).is_err());
    }
    assert!(
        read_request(&mut Cursor::new([]), 1, true)
            .unwrap()
            .is_none()
    );
}

#[test]
fn frame_and_embedded_request_limits_reject_before_execution() {
    let mut huge = vec![b' '; MAX_HEADER + 1];
    huge.push(b'\n');
    assert!(read_request(&mut Cursor::new(huge), 1, true).is_err());
    let directory = tempfile::tempdir().unwrap();
    let mut bytes = format!(
        "{{\"requestId\":1,\"cancellationPath\":{},\"request\":{{",
        serde_json::to_string(directory.path()).unwrap()
    )
    .into_bytes();
    bytes.resize(bytes.len() + MAX_REQUEST, b' ');
    bytes.extend_from_slice(b"}}\n");
    assert!(read_request(&mut Cursor::new(bytes), 1, true).is_err());
}

#[test]
fn serial_session_resets_cancellation_progress_and_preserves_binary_boundaries() {
    let directory = tempfile::tempdir().unwrap();
    let cancelled = directory.path().join("cancelled");
    std::fs::write(&cancelled, b"").unwrap();
    let fresh = directory.path().join("fresh");
    let payload = b"a\n\0b\n";
    let mut bytes = frame(1, &cancelled, json!({"operation":"writeFile"}), Some(0));
    bytes.extend(frame(
        2,
        &fresh,
        json!({"operation":"writeFile"}),
        Some(payload.len() as u64),
    ));
    bytes.extend(payload);
    bytes.extend(frame(3, &fresh, json!({"operation":"writeFile"}), Some(0)));
    let signals = Signals::default();
    let mut replies = Vec::new();
    let calls = std::cell::Cell::new(0);
    session(
        &mut WipingReader::new(Cursor::new(bytes)),
        &signals,
        true,
        |_, raw, context| {
            assert!(context.last_progress.lock().unwrap().is_none());
            assert_eq!(
                context.request_id,
                Some(if raw.unwrap().is_empty() { 3 } else { 2 })
            );
            assert!(raw == Some(payload.as_slice()) || raw == Some(b"".as_slice()));
            calls.set(calls.get() + 1);
            Ok(Value::Null)
        },
        |response| {
            replies.push(response.clone());
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(calls.get(), 2);
    assert_eq!(replies[0], json!({"type":"ready","protocol":1}));
    assert_eq!(replies[1]["error"]["code"], "CORE_CANCELLED");
    for (reply, id) in replies[1..].iter().zip(1..=3) {
        assert_eq!(reply["requestId"], id);
    }
    assert!(signals.active.lock().unwrap().is_none());
}

#[test]
fn binary_payload_sizes_preserve_nuls_newlines_and_the_next_frame() {
    let directory = tempfile::tempdir().unwrap();
    for length in [8191, 8192, 8193, MAX_BINARY as usize] {
        let payload: Vec<_> = (0..length)
            .map(|index| [0, b'\n', b'x'][index % 3])
            .collect();
        let mut bytes = frame(
            1,
            directory.path(),
            json!({"operation":"writeFile"}),
            Some(length as u64),
        );
        bytes.extend_from_slice(&payload);
        bytes.extend(frame(
            2,
            directory.path(),
            json!({"operation":"next"}),
            None,
        ));
        let mut reader = WipingReader::new(ObservedReader::new(bytes));
        let calls = std::cell::Cell::new(0);
        session(
            &mut reader,
            &Signals::default(),
            true,
            |request, raw, context| {
                if context.request_id == Some(1) {
                    assert_eq!(raw, Some(payload.as_slice()));
                } else {
                    assert_eq!(context.request_id, Some(2));
                    assert_eq!(request["operation"], "next");
                    assert!(raw.is_none());
                }
                calls.set(calls.get() + 1);
                Ok(Value::Null)
            },
            |_| Ok(()),
        )
        .unwrap();
        assert_eq!(calls.get(), 2);
        assert!(reader.bytes.iter().all(|byte| *byte == 0));
        if length == MAX_BINARY as usize {
            assert!(reader.source.calls.iter().any(|(_, length)| *length > 8192));
        }
    }
}

#[test]
fn truncated_direct_payload_never_activates_or_executes_the_handler() {
    let directory = tempfile::tempdir().unwrap();
    let mut bytes = frame(
        1,
        directory.path(),
        json!({"operation":"writeFile"}),
        Some(3 * 8192),
    );
    bytes.extend(vec![b'x'; 2 * 8192]);
    let signals = Signals::default();
    let calls = std::cell::Cell::new(0);
    let replies = std::cell::Cell::new(0);
    let mut reader = WipingReader::new(ObservedReader::new(bytes));
    assert!(
        session(
            &mut reader,
            &signals,
            true,
            |_, _, _| {
                calls.set(calls.get() + 1);
                Ok(Value::Null)
            },
            |_| {
                replies.set(replies.get() + 1);
                Ok(())
            },
        )
        .is_err()
    );
    assert_eq!(calls.get(), 0);
    assert_eq!(replies.get(), 1);
    assert!(signals.active.lock().unwrap().is_none());
    assert!(reader.source.calls.iter().any(|(_, length)| *length > 8192));
    assert!(reader.bytes.iter().all(|byte| *byte == 0));
}

#[test]
fn domain_errors_continue_but_truncated_payloads_and_bad_ids_are_fatal() {
    let directory = tempfile::tempdir().unwrap();
    let mut bytes = frame(1, directory.path(), json!({"operation":"fail"}), None);
    bytes.extend(frame(
        2,
        directory.path(),
        json!({"operation":"writeFile"}),
        Some(2),
    ));
    bytes.push(b'1');
    let mut replies = Vec::new();
    assert!(
        session(
            &mut WipingReader::new(Cursor::new(bytes)),
            &Signals::default(),
            true,
            |_, _, _| Err(invalid()),
            |reply| {
                replies.push(reply.clone());
                Ok(())
            }
        )
        .is_err()
    );
    assert_eq!(replies.len(), 2);
    assert_eq!(replies[1]["type"], "error");
    let mut bytes = frame(1, directory.path(), json!({}), None);
    bytes.extend(frame(1, directory.path(), json!({}), None));
    let count = std::cell::Cell::new(0);
    assert!(
        session(
            &mut Cursor::new(bytes),
            &Signals::default(),
            false,
            |_, _, _| {
                count.set(count.get() + 1);
                Ok(Value::Null)
            },
            |_| Ok(())
        )
        .is_err()
    );
    assert_eq!(count.get(), 1);
}

#[test]
fn nested_sensitive_values_are_cleared_and_output_errors_stop_the_session() {
    let mut value = json!({"key":"private","nested":["also-private",1,false,null]});
    wipe(&mut value);
    assert_eq!(value, json!({}));
    let directory = tempfile::tempdir().unwrap();
    let bytes = frame(1, directory.path(), json!({}), None);
    let writes = std::cell::Cell::new(0);
    assert!(
        session(
            &mut Cursor::new(bytes),
            &Signals::default(),
            false,
            |_, _, _| Ok(json!("sensitive")),
            |_| {
                writes.set(writes.get() + 1);
                if writes.get() > 1 {
                    Err(invalid())
                } else {
                    Ok(())
                }
            }
        )
        .is_err()
    );
    assert_eq!(writes.get(), 2);
}

#[test]
fn signal_cancels_active_operation_and_prevents_the_next_request() {
    let directory = tempfile::tempdir().unwrap();
    let mut bytes = frame(1, directory.path(), json!({}), None);
    bytes.extend(frame(2, directory.path(), json!({}), None));
    let signals = Signals::default();
    let mut replies = Vec::new();
    session(
        &mut Cursor::new(bytes),
        &signals,
        false,
        |_, _, context| {
            signals.stop();
            context.check()?;
            Ok(Value::Null)
        },
        |reply| {
            replies.push(reply.clone());
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(replies.len(), 2);
    assert_eq!(replies[1]["error"]["code"], "CORE_CANCELLED");
}

#[test]
fn branding_metadata_is_bounded_and_unambiguous_before_binary_reads() {
    let directory = tempfile::tempdir().unwrap();
    for request in [
        json!({"operation":"brandingPublish"}),
        json!({"operation":"brandingPublish","binaryLengths":null}),
        json!({"operation":"brandingPublish","binaryLengths":[]}),
        json!({"operation":"brandingPublish","binaryLengths":[1,1]}),
        json!({"operation":"brandingPublish","binaryLengths":[1,1,1,1]}),
        json!({"operation":"brandingPublish","binaryLengths":[0,1,2]}),
        json!({"operation":"brandingPublish","binaryLengths":[1,-1,1]}),
        json!({"operation":"brandingPublish","binaryLengths":[1,null,1]}),
        json!({"operation":"brandingPublish","binaryLengths":[1,1.5,1]}),
        json!({"operation":"brandingPublish","binaryLengths":[1,"1",1]}),
        json!({"operation":"brandingPublish","binaryLengths":[MAX_BINARY+1,1,1]}),
        json!({"operation":"brandingPublish","binaryLengths":[u64::MAX,1,1]}),
        json!({"operation":"unknown","binaryLengths":[1,1,1]}),
        json!({"operation":"writeFile","binaryLengths":[1,1,1]}),
    ] {
        assert!(
            read_request(
                &mut Cursor::new(frame(1, directory.path(), request, Some(3))),
                1,
                true
            )
            .is_err()
        );
    }
    let valid = json!({"operation":"brandingPublish","binaryLengths":[1,1,1]});
    for total in [None, Some(0), Some(2), Some(4), Some(3 * MAX_BINARY + 1)] {
        assert!(
            read_request(
                &mut Cursor::new(frame(1, directory.path(), valid.clone(), total)),
                1,
                true
            )
            .is_err()
        );
    }
    for field in ["largeBase64", "smallBase64", "faviconBase64"] {
        let mut mixed = valid.clone();
        mixed[field] = Value::Null;
        assert!(
            read_request(
                &mut Cursor::new(frame(1, directory.path(), mixed, Some(3))),
                1,
                true
            )
            .is_err()
        );
    }
    for (lengths, total) in [([1, 1, 1], 3), ([MAX_BINARY; 3], 3 * MAX_BINARY)] {
        let request = json!({"operation":"brandingPublish","binaryLengths":lengths});
        assert!(
            read_request(
                &mut Cursor::new(frame(1, directory.path(), request.clone(), Some(total))),
                1,
                true
            )
            .is_ok()
        );
        assert!(
            read_request(
                &mut Cursor::new(frame(1, directory.path(), request, Some(total))),
                1,
                false
            )
            .is_err()
        );
    }
    for operation in [
        "brandingPublish",
        "writeFile",
        "readBackgroundBytes",
        "unknown",
    ] {
        assert!(
            read_request(
                &mut Cursor::new(frame(
                    1,
                    directory.path(),
                    json!({"operation":operation,"binaryLengths":null}),
                    None
                )),
                1,
                true
            )
            .is_err()
        );
    }
}

#[test]
fn fragmented_branding_payload_keeps_binary_delimiters_and_the_following_frame() {
    let directory = tempfile::tempdir().unwrap();
    let payload = b"a\n\0b\0\nc\n\0";
    let request = json!({"operation":"brandingPublish","binaryLengths":[3,3,3]});
    let mut bytes = frame(1, directory.path(), request, Some(payload.len() as u64));
    bytes.extend_from_slice(payload);
    bytes.extend(frame(
        2,
        directory.path(),
        json!({"operation":"next"}),
        None,
    ));
    let mut source = ObservedReader::new(bytes);
    source.chunk = 1;
    let calls = std::cell::Cell::new(0);
    session(
        &mut WipingReader::new(source),
        &Signals::default(),
        true,
        |request, binary, _| {
            if request["operation"] == "brandingPublish" {
                assert_eq!(binary, Some(payload.as_slice()));
            } else {
                assert!(binary.is_none());
            }
            calls.set(calls.get() + 1);
            Ok(Value::Null)
        },
        |_| Ok(()),
    )
    .unwrap();
    assert_eq!(calls.get(), 2);
}

#[test]
fn binary_responses_have_exact_headers_and_no_trailing_separator() {
    let directory = tempfile::tempdir().unwrap();
    for payload in [
        vec![],
        b"private\n\0data\n".to_vec(),
        vec![42; MAX_BINARY as usize],
    ] {
        let mut input = frame(
            1,
            directory.path(),
            json!({"operation":"readBackgroundBytes"}),
            None,
        );
        input.extend(frame(
            2,
            directory.path(),
            json!({"operation":"next"}),
            None,
        ));
        let mut output = Vec::new();
        worker_session(
            &mut Cursor::new(input),
            &Signals::default(),
            true,
            |request, _, _| {
                Ok(if request["operation"] == "readBackgroundBytes" {
                    WorkerResponse::Binary(Zeroizing::new(payload.clone()))
                } else {
                    WorkerResponse::Json(Value::Null)
                })
            },
            |header, raw| write_response(&mut output, header, raw),
        )
        .unwrap();
        let mut expected = serde_json::to_vec(&json!({"type":"ready","protocol":1})).unwrap();
        expected.push(b'\n');
        expected.extend(
            serde_json::to_vec(
                &json!({"type":"binaryResult","requestId":1,"binaryBytes":payload.len()}),
            )
            .unwrap(),
        );
        expected.push(b'\n');
        expected.extend(payload);
        expected.extend(
            serde_json::to_vec(&json!({"type":"result","requestId":2,"result":null})).unwrap(),
        );
        expected.push(b'\n');
        assert_eq!(output, expected);
    }
}

#[test]
fn binary_output_is_scoped_bounded_and_stops_after_an_output_failure() {
    let directory = tempfile::tempdir().unwrap();
    for (operation, length) in [
        ("other", 1),
        ("readBackgroundBytes", MAX_BINARY as usize + 1),
    ] {
        let mut replies = Vec::new();
        worker_session(
            &mut Cursor::new(frame(
                1,
                directory.path(),
                json!({"operation":operation}),
                None,
            )),
            &Signals::default(),
            true,
            |_, _, _| Ok(WorkerResponse::Binary(Zeroizing::new(vec![0; length]))),
            |header, raw| {
                assert!(raw.is_none());
                replies.push(header.clone());
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(replies[1]["error"]["code"], "CORE_PROTOCOL_ERROR");
    }
    let mut input = frame(
        1,
        directory.path(),
        json!({"operation":"readBackgroundBytes"}),
        None,
    );
    input.extend(frame(2, directory.path(), json!({}), None));
    let calls = std::cell::Cell::new(0);
    let signals = Signals::default();
    assert!(
        worker_session(
            &mut Cursor::new(input),
            &signals,
            true,
            |_, _, _| {
                calls.set(calls.get() + 1);
                Ok(WorkerResponse::Binary(Zeroizing::new(vec![1])))
            },
            |_, raw| if raw.is_some() {
                Err(invalid())
            } else {
                Ok(())
            }
        )
        .is_err()
    );
    assert_eq!(calls.get(), 1);
    assert!(signals.active.lock().unwrap().is_none());
}

#[test]
fn binary_response_writer_propagates_header_separator_payload_and_flush_failures() {
    struct FailingWriter {
        remaining: usize,
        fail_flush: bool,
    }
    impl Write for FailingWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if self.remaining == 0 {
                return Err(io::ErrorKind::BrokenPipe.into());
            }
            let count = bytes.len().min(self.remaining);
            self.remaining -= count;
            Ok(count)
        }
        fn flush(&mut self) -> io::Result<()> {
            if self.fail_flush {
                Err(io::ErrorKind::BrokenPipe.into())
            } else {
                Ok(())
            }
        }
    }
    let header = json!({"type":"binaryResult","requestId":1,"binaryBytes":3});
    let length = serde_json::to_vec(&header).unwrap().len();
    for remaining in [0, length, length + 1, length + 2] {
        assert!(
            write_response(
                &mut FailingWriter {
                    remaining,
                    fail_flush: false
                },
                &header,
                Some(b"a\0\n")
            )
            .is_err()
        );
    }
    assert!(
        write_response(
            &mut FailingWriter {
                remaining: usize::MAX,
                fail_flush: true
            },
            &header,
            Some(b"a\0\n")
        )
        .is_err()
    );
}
