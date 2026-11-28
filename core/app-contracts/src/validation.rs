use std::collections::HashSet;

use serde_json::Value;

use crate::{ContractError, ManifestEnvironment};

// Internal accessors run only after the bundled schema has accepted the value.
pub(super) fn string(value: &Value) -> &str {
    value.as_str().expect("validated string")
}

pub(super) fn array(value: &Value) -> &[Value] {
    value.as_array().expect("validated array")
}

pub(super) fn integer(value: &Value) -> u64 {
    // JSON Schema accepts integral numbers such as 1.0. Schema bounds keep
    // these non-negative integers exactly representable on both runtimes.
    value.as_f64().expect("validated integer") as u64
}

fn version_number(version: &str) -> u64 {
    version.split('.').fold(0, |value, part| {
        value * 1_000_000 + part.parse::<u64>().expect("validated version component")
    })
}

fn range_bounds(range: &Value) -> (u64, u64) {
    let (minimum, maximum) = string(range)[2..]
        .split_once(" <")
        .expect("validated range");
    (version_number(minimum), version_number(maximum))
}

fn ordered_range(range: &Value) -> bool {
    let (minimum, maximum) = range_bounds(range);
    minimum < maximum
}

fn supports_protocol(range: &Value, available: &str) -> bool {
    fn valid_component(part: &str) -> bool {
        !part.is_empty()
            && part.len() <= 6
            && (part == "0" || !part.starts_with('0'))
            && part.bytes().all(|byte| byte.is_ascii_digit())
    }
    let Some((minor, patch)) = available
        .strip_prefix("1.")
        .and_then(|version| version.split_once('.'))
    else {
        return false;
    };
    if !valid_component(minor) || !valid_component(patch) {
        return false;
    }
    let (minimum, maximum) = range_bounds(range);
    (minimum..maximum).contains(&version_number(available))
}

pub(super) fn unique_strings<'a>(mut values: impl Iterator<Item = &'a str>) -> bool {
    let mut unique = HashSet::new();
    values.all(|value| unique.insert(value))
}

fn valid_data_versions(data: &Value) -> bool {
    let target = integer(&data["targetVersion"]);
    let reads = array(&data["readVersions"]);
    let writes = array(&data["writeVersions"]);
    let readable: HashSet<_> = reads.iter().map(integer).collect();
    let writable: HashSet<_> = writes.iter().map(integer).collect();
    if readable.len() != reads.len()
        || writable.len() != writes.len()
        || !writable.contains(&target)
        || !writable.is_subset(&readable)
    {
        return false;
    }

    let migrations = array(&data["migrations"]);
    let starts: HashSet<_> = migrations
        .iter()
        .map(|step| integer(&step["fromVersion"]))
        .collect();
    let mut previous = None;
    for step in migrations {
        let from = integer(&step["fromVersion"]);
        let to = integer(&step["toVersion"]);
        if previous.is_some_and(|last| from <= last)
            || to <= from
            || to > target
            || (to != target && !starts.contains(&to))
        {
            return false;
        }
        previous = Some(from);
    }
    true
}

pub(super) fn validate_manifest(manifest: &Value) -> Result<(), ContractError> {
    let requires = &manifest["requires"];
    let ui = manifest.get("ui");
    let bridge = requires.get("uiBridge");
    if !ordered_range(&requires["platformApi"])
        || !ordered_range(&requires["appProtocol"])
        || ui.is_some() != bridge.is_some()
        || bridge.is_some_and(|range| !ordered_range(range))
        || !unique_strings(
            array(&manifest["capabilities"])
                .iter()
                .map(|item| string(&item["id"])),
        )
        || !unique_strings(array(&manifest["permissions"]).iter().map(string))
        || !unique_strings(array(&manifest["providers"]).iter().map(string))
        || !unique_strings(array(&requires["engineCapabilities"]).iter().map(string))
        || ui.is_some_and(|ui| !unique_strings(array(&ui["slots"]).iter().map(string)))
        || manifest
            .get("data")
            .is_some_and(|data| !valid_data_versions(data))
    {
        return Err(ContractError::InvalidManifest);
    }
    let categories = manifest.get("incidentCategories");
    let manages_incidents = array(&manifest["capabilities"])
        .iter()
        .any(|item| string(&item["id"]) == "notifications.incidents.manage.v1");
    if manages_incidents != categories.is_some()
        || categories.is_some_and(|categories| {
            !unique_strings(array(categories).iter().map(|item| string(&item["id"])))
        })
    {
        return Err(ContractError::InvalidManifest);
    }
    Ok(())
}

pub(super) fn check_manifest_compatibility(
    manifest: &Value,
    environment: &ManifestEnvironment<'_>,
) -> Result<(), ContractError> {
    let requires = &manifest["requires"];
    if manifest["target"] != environment.target
        || requires["runtimeProfile"] != environment.runtime_profile
        || !supports_protocol(&requires["platformApi"], environment.platform_api)
        || !supports_protocol(&requires["appProtocol"], environment.app_protocol)
        || requires.get("uiBridge").is_some_and(|range| {
            !environment
                .ui_bridge
                .is_some_and(|version| supports_protocol(range, version))
        })
        || array(&requires["engineCapabilities"])
            .iter()
            .any(|capability| {
                !environment
                    .engine_capabilities
                    .contains(&string(capability))
            })
    {
        return Err(ContractError::IncompatibleManifest);
    }
    Ok(())
}

pub(super) fn matches_record(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => left.as_f64() == right.as_f64(),
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len() && left.iter().zip(right).all(|(l, r)| matches_record(l, r))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, value)| {
                    right
                        .get(key)
                        .is_some_and(|other| matches_record(value, other))
                })
        }
        _ => left == right,
    }
}

pub(super) fn validate_release(release: &Value) -> Result<(), ContractError> {
    let id = string(&release["appId"]);
    let namespace = string(&release["publisher"]["namespace"]);
    let packages = array(&release["packages"]);
    if id.split_once('.').map(|(prefix, _)| prefix) != Some(namespace)
        || !unique_strings(
            packages
                .iter()
                .map(|item| string(&item["manifest"]["target"])),
        )
        || (namespace == "rentnerproxy" && packages.len() != 2)
    {
        return Err(ContractError::InvalidRelease);
    }
    let display = &packages[0]["manifest"]["display"];
    for artifact in packages {
        let manifest = &artifact["manifest"];
        validate_manifest(manifest)?;
        if manifest["id"] != id
            || manifest["version"] != release["version"]
            || !matches_record(&manifest["source"], &release["source"])
            || !matches_record(&manifest["display"], display)
        {
            return Err(ContractError::InvalidRelease);
        }
    }
    Ok(())
}

pub(super) fn validate_candidate(candidate: &Value) -> Result<(), ContractError> {
    let release = &candidate["release"];
    validate_release(release)?;
    if !matches_record(&candidate["source"], &release["source"]) {
        return Err(ContractError::InvalidCandidate);
    }
    Ok(())
}

pub(super) fn validate_catalog(catalog: &Value) -> Result<(), ContractError> {
    let releases = array(&catalog["releases"]);
    let revocations = array(&catalog["revocations"]);
    let mut identities = HashSet::new();
    for entry in releases.iter().chain(revocations) {
        if !identities.insert((string(&entry["appId"]), string(&entry["version"]))) {
            return Err(ContractError::InvalidCatalog);
        }
    }
    for release in releases {
        validate_release(release)?;
    }
    Ok(())
}
