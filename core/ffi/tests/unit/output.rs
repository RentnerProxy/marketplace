use super::*;

#[test]
fn reports_unexpected_binary_response_as_uncertain() {
    let output = StorageOutput::from_result(Ok(WorkerResponse::VersionedBinary {
        bytes: Zeroizing::new(vec![0, 1, 2, 3]),
        version: "a".repeat(64),
    }));
    let metadata: Value = serde_json::from_slice(output.json()).unwrap();
    assert_eq!(metadata["type"], "error");
    assert_eq!(metadata["error"]["code"], "CORE_OPERATION_UNCERTAIN");
}

#[test]
fn reports_oversized_result_metadata_as_uncertain() {
    let result = Value::String("x".repeat(MAX_RECORD_BYTES));
    let output = StorageOutput::from_result(Ok(WorkerResponse::Json(result)));
    assert!(output.json().len() < MAX_RECORD_BYTES);
    assert_eq!(
        serde_json::from_slice::<Value>(output.json()).unwrap()["error"]["code"],
        "CORE_OPERATION_UNCERTAIN"
    );
}
