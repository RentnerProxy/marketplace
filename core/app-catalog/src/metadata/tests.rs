use ed25519_dalek::{Signer, SigningKey};
use serde_json::{Value, json};

use super::*;

fn legacy_root() -> Value {
    let files: BTreeMap<String, String> =
        serde_json::from_str(include_str!("../../tests/fixtures/tuf-js-bootstrap.json")).unwrap();
    decode(files["metadata/1.root.json"].as_bytes()).unwrap()
}

fn parse_root(value: &Value) -> Result<Root> {
    Root::parse(&serde_json::to_vec(value).unwrap(), None)
}

#[test]
fn decodes_unambiguous_wire_json_before_canonicalizing() {
    let all_types = br#"{"null":null,"bool":true,"list":[-2,3,1.25,"text"],"empty":{}}"#;
    assert_eq!(
        decode(all_types).unwrap(),
        serde_json::from_slice::<Value>(all_types).unwrap()
    );
    for bytes in [
        br#"{"signed":{"version":1,"\u0076ersion":2}}"#.as_slice(),
        br#"{"items":[{"a":false,"a":true}]}"#,
        br#"{"x":1} {}"#,
        br#"{"x":"\ud800"}"#,
        b"[]",
        b"{\"\xff\":true}",
    ] {
        assert!(decode(bytes).is_err());
    }
    assert_eq!(
        canonical(&json!({"z": [], "b": {"b": 2, "a": 1}, "a": 3})).unwrap(),
        br#"{"a":3,"b":{"a":1,"b":2},"z":[]}"#
    );
    assert!(canonical(&json!({"fraction": 0.5})).is_err());
}

#[test]
fn requires_unique_authorized_signatures_and_valid_thresholds() {
    let valid = legacy_root();
    assert!(parse_root(&valid).is_ok());

    let mut one = valid.clone();
    one["signatures"].as_array_mut().unwrap().pop();
    assert!(
        parse_root(&one)
            .unwrap_err()
            .to_string()
            .contains("signed by 1")
    );

    let mut duplicate = valid.clone();
    duplicate["signatures"][1] = duplicate["signatures"][0].clone();
    assert!(
        parse_root(&duplicate)
            .unwrap_err()
            .to_string()
            .contains("duplicate")
    );

    for threshold in [json!(0), json!(3), json!(1.5), json!("2")] {
        let mut invalid = valid.clone();
        invalid["signed"]["roles"]["root"]["threshold"] = threshold;
        assert!(parse_root(&invalid).is_err());
    }
}

#[test]
fn authenticates_legacy_key_id_hash_algorithms_and_compatible_spec_versions() {
    let mut root = legacy_root();
    root["signed"]["spec_version"] = "1.0.31".into();
    for key in root["signed"]["keys"].as_object_mut().unwrap().values_mut() {
        key["keyid_hash_algorithms"] = json!(["sha256", "sha512"]);
    }
    let message = canonical(&root["signed"]).unwrap();
    let ids = root["signed"]["roles"]["root"]["keyids"]
        .as_array()
        .unwrap();
    let signatures: Vec<Value> = [1u8, 2]
        .iter()
        .zip(ids)
        .map(|(seed, id)| {
            let key = SigningKey::from_bytes(&[*seed; 32]);
            json!({"keyid": id, "sig": hex::encode(key.sign(&message).to_bytes())})
        })
        .collect();
    root["signatures"] = signatures.into();
    assert!(parse_root(&root).is_ok());

    let id = root["signed"]["roles"]["root"]["keyids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    root["signed"]["keys"][&id]["keyid_hash_algorithms"] = json!(["sha256"]);
    assert!(
        parse_root(&root)
            .unwrap_err()
            .to_string()
            .contains("signed by 0")
    );
    root["signed"]["keys"][&id]["keyid_hash_algorithms"] = json!(["sha2\u{301}"]);
    assert!(
        parse_root(&root)
            .unwrap_err()
            .to_string()
            .contains("algorithm name")
    );
}

#[test]
fn rejects_unusable_or_reused_root_keys() {
    let root = legacy_root();
    let first = root["signed"]["roles"]["root"]["keyids"][0]
        .as_str()
        .unwrap();
    let second = root["signed"]["roles"]["root"]["keyids"][1]
        .as_str()
        .unwrap();
    for public in [
        "00".repeat(32),
        format!("01{}", "00".repeat(31)),
        "AB".repeat(32),
        "bad".into(),
    ] {
        let mut invalid = root.clone();
        invalid["signed"]["keys"][first]["keyval"]["public"] = public.into();
        assert!(parse_root(&invalid).is_err());
    }
    let mut reused = root.clone();
    reused["signed"]["keys"][first] = reused["signed"]["keys"][second].clone();
    assert!(
        parse_root(&reused)
            .unwrap_err()
            .to_string()
            .contains("reused")
    );
    let mut unknown = root.clone();
    unknown["signed"]["keys"]["unexpected"] = root["signed"]["keys"][first].clone();
    assert!(
        parse_root(&unknown)
            .unwrap_err()
            .to_string()
            .contains("Unexpected root key")
    );
    let mut absent = root;
    absent["signed"]["roles"]
        .as_object_mut()
        .unwrap()
        .remove("snapshot");
    assert!(
        parse_root(&absent)
            .unwrap_err()
            .to_string()
            .contains("Missing root role")
    );
}

#[test]
fn rejects_unsupported_versions_expirations_and_oversized_roles() {
    let root = legacy_root();
    for bad in [json!(0), json!(-1), json!(1.5), json!(MAX_SAFE_VERSION + 1)] {
        let mut invalid = root.clone();
        invalid["signed"]["version"] = bad;
        assert!(
            parse_root(&invalid)
                .unwrap_err()
                .to_string()
                .contains("metadata version")
        );
    }
    for bad in [
        "2027-02-29T00:00:00Z",
        "2027-12-01T24:00:00Z",
        "2027-12-01T00:00:00z",
        "2027-12-01T00:00:00.0Z",
    ] {
        let mut invalid = root.clone();
        invalid["signed"]["expires"] = bad.into();
        assert!(
            parse_root(&invalid)
                .unwrap_err()
                .to_string()
                .contains("expiry")
        );
    }
    for bad in ["2.0.0", "1.x", "1", "1.0.", "1.0.0.0"] {
        assert!(!supported_spec(&json!(bad)));
    }
    assert!(supported_spec(&json!("1.0")));
    assert!(Envelope::parse(&vec![b' '; Role::Timestamp.limit() + 1], Role::Timestamp).is_err());
}

#[test]
fn bounds_signed_files_and_permitted_target_names() {
    let file = FileInfo::from_bytes(b"catalog");
    assert!(file.verify(b"catalog", 7).is_ok());
    assert!(file.verify(b"CAtalog", 7).is_err());
    assert!(file.validate(6).is_err());
    for wire in [
        json!({"length":0,"hashes":{"sha256":file.sha256}}),
        json!({"length":-1,"hashes":{"sha256":file.sha256}}),
        json!({"length":8,"hashes":{"sha256":file.sha256}}),
        json!({"length":7,"hashes":{"sha256":file.sha256,"sha512":"extra"}}),
        json!({"length":7,"hashes":{"sha256":"bad"}}),
    ] {
        assert!(FileInfo::parse(&wire, 7).is_err());
    }
    assert_eq!(target_limit("catalog.json").unwrap(), CATALOG_LIMIT);
    for format in ["png", "webp"] {
        assert_eq!(
            target_limit(&format!("assets/{}.{format}", file.sha256)).unwrap(),
            ICON_LIMIT
        );
    }
    for name in [
        "../catalog.json",
        "assets/icon.webp",
        "/catalog.json",
        "assets/other.svg",
    ] {
        assert!(target_limit(name).is_err());
    }
}
