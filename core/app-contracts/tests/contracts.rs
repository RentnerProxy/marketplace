use std::sync::LazyLock;

use rentnerproxy_app_contracts::Contracts;
use serde_json::{Value, json};

static FIXTURES: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../contracts/v1/fixtures.json")).unwrap()
});
static CONTRACTS: LazyLock<Contracts> = LazyLock::new(|| Contracts::new().unwrap());

fn documents() -> Value {
    let records = &FIXTURES["records"];
    let mut release = records["release"].clone();
    let packages: Vec<_> = FIXTURES["targets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|fixture| {
            let mut manifest = FIXTURES["manifest"].clone();
            let mut artifact = fixture.as_object().unwrap().clone();
            manifest["target"] = artifact.remove("target").unwrap();
            artifact.insert("manifest".to_string(), manifest);
            Value::Object(artifact)
        })
        .collect();
    release["packages"] = json!(packages);

    let mut candidate = records["candidate"].clone();
    candidate["release"] = release.clone();
    let mut approval = records["approval"].clone();
    approval["candidate"] = candidate.clone();
    let mut receipt = records["receipt"].clone();
    receipt["release"] = release.clone();
    let mut catalog = records["catalog"].clone();
    catalog["releases"] = json!([release]);
    json!({
        "manifest": FIXTURES["manifest"],
        "candidate": candidate,
        "approval": approval,
        "receipt": receipt,
        "catalog": catalog,
    })
}

#[test]
fn six_official_profiles_support_both_targets() {
    for profile in FIXTURES["profiles"].as_array().unwrap() {
        for target in FIXTURES["targets"].as_array().unwrap() {
            let mut manifest = FIXTURES["manifest"].clone();
            let name = profile["profile"].as_str().unwrap();
            manifest["id"] = json!(format!("rentnerproxy.{name}"));
            manifest["display"]["name"] = profile["name"].clone();
            manifest["target"] = target["target"].clone();
            manifest["providers"] = json!([name]);
            manifest["capabilities"] = profile["capabilities"].clone();
            manifest["requires"]["engineCapabilities"] = profile["engineCapabilities"].clone();
            CONTRACTS.validate_manifest(&manifest).unwrap();
        }
    }
}

#[test]
fn approved_bytes_are_resolvable_from_the_standalone_catalog() {
    let input = documents();
    CONTRACTS
        .check_approval_binding(&input["candidate"], &input["approval"])
        .unwrap();
    CONTRACTS
        .check_publication_binding(&input["approval"], &input["receipt"], &input["catalog"])
        .unwrap();
    let catalog = CONTRACTS.validate_catalog(&input["catalog"]).unwrap();
    let package = catalog
        .package("rentnerproxy.monitoring", "0.1.0-beta.1", "linux-arm64")
        .unwrap();
    let expected = &FIXTURES["published"];
    assert_eq!(expected["downloadUrl"], package.download_url());
    assert_eq!(expected["archiveSha256"], package.archive_sha256());
    assert_eq!(expected["archiveSizeBytes"], package.archive_size_bytes());
    assert_eq!(expected["manifestSha256"], package.manifest_sha256());
    assert_eq!(
        expected["iconPath"],
        catalog
            .icon_path("rentnerproxy.monitoring", "0.1.0-beta.1")
            .unwrap()
    );
    assert!(
        catalog
            .package("rentnerproxy.monitoring", "0.0.9", "linux-arm64")
            .is_none()
    );
}

#[test]
fn approvals_ignore_lexical_forms_of_the_same_bounded_integer() {
    let mut input = documents();
    input["candidate"]["build"]["attempt"] = json!(1.0);
    input["candidate"]["release"]["packages"][0]["manifest"]["data"]["migrations"][0]["fromVersion"] =
        json!(-0.0);
    CONTRACTS
        .check_approval_binding(&input["candidate"], &input["approval"])
        .unwrap();
}

#[test]
fn approvals_reject_an_internally_consistent_new_commit() {
    let mut input = documents();
    let candidate = &mut input["candidate"];
    let commit = json!("d".repeat(40));
    candidate["source"]["commit"] = commit.clone();
    candidate["release"]["source"]["commit"] = commit.clone();
    for artifact in candidate["release"]["packages"].as_array_mut().unwrap() {
        artifact["manifest"]["source"]["commit"] = commit.clone();
    }
    assert_eq!(
        CONTRACTS
            .check_approval_binding(&input["candidate"], &input["approval"])
            .unwrap_err()
            .code(),
        "approvalMismatch"
    );
}

fn apply_mutation(documents: &mut Value, fixture: &Value) {
    let pointer = fixture["path"].as_str().unwrap();
    let (parent, key) = pointer.rsplit_once('/').unwrap();
    let replacement = fixture["copyFrom"].as_str().map_or_else(
        || fixture["value"].clone(),
        |source| documents.pointer(source).unwrap().clone(),
    );
    let container = documents.pointer_mut(parent).unwrap();
    let remove = fixture["remove"] == true;
    if let Some(array) = container.as_array_mut() {
        let index = key.parse::<usize>().unwrap();
        if remove {
            array.remove(index);
        } else if index == array.len() {
            array.push(replacement);
        } else {
            array[index] = replacement;
        }
    } else if remove {
        container.as_object_mut().unwrap().remove(key);
    } else {
        container[key] = replacement;
    }
}

#[test]
fn shared_rejection_cases_agree_with_the_typescript_contract() {
    for fixture in FIXTURES["cases"].as_array().unwrap() {
        let mut input = documents();
        apply_mutation(&mut input, fixture);
        let result = match fixture["check"].as_str().unwrap() {
            "manifest" => CONTRACTS.validate_manifest(&input["manifest"]),
            "candidate" => CONTRACTS.validate_candidate(&input["candidate"]),
            "approval" => CONTRACTS.check_approval_binding(&input["candidate"], &input["approval"]),
            "publication" => CONTRACTS.check_publication_binding(
                &input["approval"],
                &input["receipt"],
                &input["catalog"],
            ),
            "catalog" => CONTRACTS.validate_catalog(&input["catalog"]).map(|_| ()),
            other => panic!("Unknown fixture check: {other}"),
        };
        let actual = result.err().map(|error| error.code());
        assert_eq!(actual, fixture["error"].as_str(), "{}", fixture["name"]);
    }
}
