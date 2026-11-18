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

fn sign_fixture_root(root: &mut Value) {
    let message = canonical(&root["signed"]).unwrap();
    let ids = root["signed"]["roles"]["root"]["keyids"]
        .as_array()
        .unwrap();
    root["signatures"] = [1u8, 2]
        .iter()
        .zip(ids)
        .map(|(seed, id)| {
            let key = SigningKey::from_bytes(&[*seed; 32]);
            json!({"keyid": id, "sig": hex::encode(key.sign(&message).to_bytes())})
        })
        .collect();
}

fn replace_role_key(root: &mut Value, role: &str, index: usize, new_id: &str, descriptor: Value) {
    let signed = &mut root["signed"];
    let previous = signed["roles"][role]["keyids"][index]
        .as_str()
        .unwrap()
        .to_owned();
    signed["keys"]
        .as_object_mut()
        .unwrap()
        .remove(&previous)
        .unwrap();
    signed["keys"][new_id] = descriptor;
    signed["roles"][role]["keyids"][index] = new_id.into();
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

    for (threshold, reason) in [
        (json!(0), "Invalid role threshold"),
        (json!(3), "Invalid role threshold"),
        (json!(1.5), "Invalid canonical TUF metadata"),
        (json!("2"), "Invalid root roles"),
    ] {
        let mut invalid = valid.clone();
        invalid["signed"]["roles"]["root"]["threshold"] = threshold;
        assert_eq!(parse_root(&invalid).unwrap_err().to_string(), reason);
    }
}

#[test]
fn authenticates_legacy_key_id_hash_algorithms_and_compatible_spec_versions() {
    let mut root = legacy_root();
    root["signed"]["spec_version"] = "1.0.31".into();
    let previous = root["signed"]["roles"]["root"]["keyids"][0]
        .as_str()
        .unwrap();
    let mut descriptor = root["signed"]["keys"][previous].clone();
    descriptor["keyid_hash_algorithms"] = json!(["sha256", "sha512"]);
    let id = digest(&canonical(&descriptor).unwrap());
    replace_role_key(&mut root, "root", 0, &id, descriptor);
    sign_fixture_root(&mut root);
    assert!(parse_root(&root).is_ok());
    root["signed"]["keys"][&id]["keyid_hash_algorithms"] = json!(["sha256"]);
    assert_eq!(
        parse_root(&root).unwrap_err().to_string(),
        "Key ID differs from canonical descriptor SHA-256"
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
fn rejects_a_threshold_signed_root_with_an_incorrect_key_id() {
    let mut root = legacy_root();
    let id = root["signed"]["roles"]["targets"]["keyids"][0]
        .as_str()
        .unwrap();
    let descriptor = root["signed"]["keys"][id].clone();
    replace_role_key(&mut root, "targets", 0, &"0".repeat(64), descriptor);
    sign_fixture_root(&mut root);
    assert_eq!(
        parse_root(&root).unwrap_err().to_string(),
        "Key ID differs from canonical descriptor SHA-256"
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
    let mut alias = reused["signed"]["keys"][second].clone();
    alias["keyid_hash_algorithms"] = json!(["sha256"]);
    let alias_id = digest(&canonical(&alias).unwrap());
    replace_role_key(&mut reused, "root", 0, &alias_id, alias);
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
