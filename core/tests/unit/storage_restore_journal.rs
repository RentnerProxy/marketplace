use super::*;
use hmac::{Hmac, KeyInit, Mac};
use serde_json::json;

fn canonical_record(record: &Value) -> Vec<u8> {
    let fields = [
        "version",
        "purpose",
        "algorithm",
        "restoreRunId",
        "actorUserId",
        "sourceBackupId",
        "sourceChecksumSha256",
        "includesStorage",
        "sequence",
        "event",
        "occurredAt",
        "previousHmacSha256",
        "hmacSha256",
    ];
    format!(
        "{{{}}}\n",
        fields
            .map(|field| format!("\"{field}\":{}", record[field]))
            .join(",")
    )
    .into_bytes()
}
fn resign(record: &mut Value) {
    let key = STANDARD
        .decode(fixture()["keyBase64"].as_str().unwrap())
        .unwrap();
    let signed = json!([
        record["purpose"],
        record["version"],
        record["algorithm"],
        record["restoreRunId"],
        record["actorUserId"],
        record["sourceBackupId"],
        record["sourceChecksumSha256"],
        record["includesStorage"],
        record["sequence"],
        record["event"],
        record["occurredAt"],
        record["previousHmacSha256"]
    ]);
    let mut hmac = Hmac::<sha2::Sha256>::new_from_slice(&key).unwrap();
    hmac.update(&serde_json::to_vec(&signed).unwrap());
    record["hmacSha256"] = json!(
        hmac.finalize()
            .into_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
}

fn fixture() -> Value {
    serde_json::from_str(include_str!("../fixtures/restore-journal-v1.json")).unwrap()
}
fn validate(content: &[u8], binding: Value, key: Value) -> CoreResult<Value> {
    let binding = format::parse_binding(&binding)?;
    let key = STANDARD
        .decode(key.as_str().ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    if key.len() != 32 {
        return Err(invalid());
    }
    Ok(serde_json::to_value(format::validate(
        content, &binding, &key,
    )?)?)
}
fn content() -> Vec<u8> {
    STANDARD
        .decode(fixture()["contentBase64"].as_str().unwrap())
        .unwrap()
}
fn check(bytes: &[u8]) -> bool {
    let f = fixture();
    validate(bytes, f["binding"].clone(), f["keyBase64"].clone()).is_ok()
}

#[test]
fn node_hkdf_hmac_fixture_is_canonically_compatible() {
    let fixture = fixture();
    let master = STANDARD
        .decode(fixture["masterKeyBase64"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        STANDARD.encode(format::derive(&master).as_slice()),
        fixture["keyBase64"].as_str().unwrap()
    );
    assert!(check(&content()));
}

#[test]
fn rejects_valid_macs_for_a_forged_predecessor_skipped_transition_and_noncanonical_time() {
    let f = fixture();
    let started = canonical_record(&f["records"][0]);
    for (field, value) in [
        ("previousHmacSha256", json!("f".repeat(64))),
        ("event", json!("applied")),
        ("occurredAt", json!("2026-09-06T10:20:30Z")),
        ("occurredAt", json!("2026-09-06T11:20:30.123+01:00")),
    ] {
        let mut record = f["records"][1].clone();
        record[field] = value;
        resign(&mut record);
        assert!(
            !check(&[started.as_slice(), canonical_record(&record).as_slice()].concat()),
            "{field}"
        );
    }
}

#[test]
fn rejects_bounds_encoding_partial_and_noncanonical_json() {
    let canonical = content();
    let mut variants = vec![
        vec![],
        vec![b'\n'; 32769],
        vec![255, b'\n'],
        canonical[..canonical.len() - 1].to_vec(),
        b"{\n".to_vec(),
    ];
    variants.push([b" ".as_slice(), &canonical].concat());
    variants.push([&canonical, b"\n".as_slice()].concat());
    variants.push([&[239, 187, 191], canonical.as_slice()].concat());
    let text = String::from_utf8(canonical.clone()).unwrap();
    variants.push(text.replace('\n', "\r\n").into_bytes());
    variants.push(
        text.replacen("restore-journal-v1", r"\u0072estore-journal-v1", 1)
            .into_bytes(),
    );
    variants.push(
        text.replacen("\"version\":1", "\"version\": 1", 1)
            .into_bytes(),
    );
    variants.push(
        text.replacen("{\"version\":1,", "{\"version\":1,\"version\":1,", 1)
            .into_bytes(),
    );
    variants.push(
        text.replacen(
            "\"version\":1,\"purpose\":\"restore-journal-v1\",",
            "\"purpose\":\"restore-journal-v1\",\"version\":1,",
            1,
        )
        .into_bytes(),
    );
    for bytes in variants {
        assert!(!check(&bytes));
    }
}

#[test]
fn rejects_foreign_binding_key_fields_chain_sequence_and_mac() {
    let f = fixture();
    let bytes = content();
    for field in [
        "restoreRunId",
        "actorUserId",
        "sourceBackupId",
        "sourceChecksumSha256",
        "includesStorage",
    ] {
        let mut binding = f["binding"].clone();
        binding[field] = if field == "includesStorage" {
            json!(false)
        } else if field == "sourceChecksumSha256" {
            json!("a".repeat(64))
        } else {
            json!("c680a997-88a0-492e-b55d-a794ba57cf43")
        };
        assert!(validate(&bytes, binding, f["keyBase64"].clone()).is_err());
    }
    assert!(
        validate(
            &bytes,
            f["binding"].clone(),
            json!(STANDARD.encode([24; 32]))
        )
        .is_err()
    );
    for (field, value) in [
        ("version", json!(2)),
        ("purpose", json!("other")),
        ("algorithm", json!("sha256")),
        ("sequence", json!(2)),
        ("event", json!("completed")),
        ("occurredAt", json!("2026-09-06T10:20:30Z")),
        ("occurredAt", json!("2026-02-30T10:20:30.000Z")),
        ("hmacSha256", json!("F".repeat(64))),
        ("hmacSha256", json!("f".repeat(64))),
        ("previousHmacSha256", json!("f".repeat(64))),
        ("extra", json!(true)),
    ] {
        let mut record = f["records"][0].clone();
        record[field] = value;
        assert!(!check(format!("{record}\n").as_bytes()), "{field}");
    }
    let lines: Vec<_> = String::from_utf8(bytes)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect();
    for indices in [
        vec![0, 0],
        vec![1, 0],
        vec![0, 1, 1],
        vec![0, 2],
        vec![0; 9],
    ] {
        assert!(!check(
            format!(
                "{}\n",
                indices
                    .iter()
                    .map(|index| lines[*index].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            )
            .as_bytes()
        ));
    }
}
