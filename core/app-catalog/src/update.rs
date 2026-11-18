use std::collections::{BTreeMap, HashMap};

use serde_json::Value;
use time::{Duration, OffsetDateTime};

use crate::metadata::{FileInfo, MetaLink, Online, Role, Root, sign_link, sign_targets};
use crate::{
    CATALOG_TARGET, CatalogDocument, CatalogError, Result, SigningKeys, TIMESTAMP_PATH,
    TrustedCatalog, next_version, replacement_root, target_path, version_path,
};

const EMPTY_CATALOG: &[u8] = br#"{"formatVersion":1,"revision":1,"releases":[],"revocations":[]}"#;

pub struct UpdateOptions<'a> {
    pub now: OffsetDateTime,
    pub next_root: Option<&'a [u8]>,
    pub icons: &'a BTreeMap<String, Vec<u8>>,
}

/// Produce the repository files for an initial empty catalog.
pub fn bootstrap_catalog(
    pinned_root: &[u8],
    keys: &SigningKeys,
    now: OffsetDateTime,
) -> Result<BTreeMap<String, Vec<u8>>> {
    let root = Root::parse(pinned_root, None)?;
    if root.version != 1 {
        return Err(CatalogError::new("Bootstrap requires root version 1"));
    }
    let mut files = BTreeMap::from([(version_path(Role::Root, 1), pinned_root.to_vec())]);
    let catalog = CatalogDocument::parse(EMPTY_CATALOG)?;
    let options = UpdateOptions {
        now,
        next_root: None,
        icons: &BTreeMap::new(),
    };
    build_update(
        &root,
        (&catalog, EMPTY_CATALOG),
        keys,
        &options,
        None,
        &mut files,
    )?;
    Ok(files)
}

/// Build a signed set of changed files against a verified checkpoint.
pub fn update_catalog(
    state: &TrustedCatalog,
    next: &[u8],
    keys: &SigningKeys,
    options: UpdateOptions<'_>,
) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut files = BTreeMap::new();
    let mut replacement = None;
    if let Some(next_root) = options.next_root.filter(|bytes| *bytes != state.root_bytes) {
        let root = replacement_root(next_root, &state.root, &state.history, options.now)?;
        files.insert(version_path(Role::Root, root.version), next_root.to_vec());
        replacement = Some(root);
    }
    let root = replacement.as_ref().unwrap_or(&state.root);
    let proposed = (next != state.catalog_bytes)
        .then(|| CatalogDocument::parse(next))
        .transpose()?;
    let proposed = proposed.as_ref().filter(|document| {
        document.revision != state.catalog.revision
            || !records_match(&document.value, &state.catalog.value)
    });
    let candidate = if let Some(document) = proposed {
        if state.catalog.revision + 1 != document.revision {
            return Err(CatalogError::new("Catalog revision must increase by one"));
        }
        validate_transition(&state.catalog, document)?;
        (document, next)
    } else {
        (state.catalog.as_ref(), state.catalog_bytes())
    };
    build_update(root, candidate, keys, &options, Some(state), &mut files)?;
    Ok(files)
}

fn validate_transition(current: &CatalogDocument, next: &CatalogDocument) -> Result<()> {
    let releases: HashMap<_, _> = next
        .releases()
        .iter()
        .map(|entry| (release_key(entry), entry))
        .collect();
    let revocations: HashMap<_, _> = next
        .revocations()
        .iter()
        .map(|entry| (release_key(entry), entry))
        .collect();
    for entry in current.revocations() {
        if !revocations
            .get(&release_key(entry))
            .is_some_and(|next| records_match(entry, next))
        {
            return Err(CatalogError::new("Existing revocation changed"));
        }
    }
    for entry in current.releases() {
        let key = release_key(entry);
        if !revocations.contains_key(&key)
            && !releases
                .get(&key)
                .is_some_and(|next| records_match(entry, next))
        {
            return Err(CatalogError::new(
                "Existing release changed without a revocation",
            ));
        }
    }
    Ok(())
}

fn records_match(left: &Value, right: &Value) -> bool {
    match (left, right) {
        // The catalog contract accepts integral JSON numbers written as 1 or 1.0.
        (Value::Number(left), Value::Number(right)) => left.as_f64() == right.as_f64(),
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len() && left.iter().zip(right).all(|(l, r)| records_match(l, r))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(name, value)| {
                    right
                        .get(name)
                        .is_some_and(|other| records_match(value, other))
                })
        }
        _ => left == right,
    }
}

fn release_key(entry: &Value) -> (&str, &str) {
    (
        entry["appId"].as_str().expect("validated app ID"),
        entry["version"].as_str().expect("validated app version"),
    )
}

fn prepare_targets(
    catalog: &CatalogDocument,
    bytes: &[u8],
    files: &mut BTreeMap<String, Vec<u8>>,
    state: Option<&TrustedCatalog>,
    supplied_icons: &BTreeMap<String, Vec<u8>>,
) -> Result<BTreeMap<String, FileInfo>> {
    let catalog_target = FileInfo::from_bytes(bytes);
    if state.is_none_or(|state| state.catalog_bytes() != bytes) {
        files.insert(target_path(CATALOG_TARGET, &catalog_target), bytes.to_vec());
    }
    let mut entries = BTreeMap::from([(CATALOG_TARGET.into(), catalog_target)]);
    if supplied_icons
        .keys()
        .any(|name| !catalog.icons.contains_key(name))
    {
        return Err(CatalogError::new("Unexpected supplied icon"));
    }
    for (name, expected) in &catalog.icons {
        let supplied = supplied_icons.get(name);
        if let Some(supplied) = supplied {
            expected
                .verify(supplied, expected.length)
                .map_err(|_| CatalogError::new("Supplied icon bytes do not match catalog"))?;
        }
        if state.and_then(|state| state.catalog.icons.get(name)) != Some(expected) {
            let bytes = supplied.ok_or_else(|| CatalogError::new("Missing approved icon bytes"))?;
            files.insert(target_path(name, expected), bytes.clone());
        }
        entries.insert(name.clone(), expected.clone());
    }
    Ok(entries)
}

fn build_update(
    root: &Root,
    (catalog, bytes): (&CatalogDocument, &[u8]),
    keys: &SigningKeys,
    options: &UpdateOptions<'_>,
    state: Option<&TrustedCatalog>,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    let now = options.now;
    if root.expires <= now {
        return Err(CatalogError::new("Expired root"));
    }
    keys.validate(root)?;

    let targets = state.map(|state| &state.targets);
    let snapshot = state.map(|state| &state.snapshot);
    let timestamp = state.map(|state| &state.timestamp);
    let sign_new_targets = state.is_none_or(|state| {
        state.root.version != root.version || state.catalog.revision != catalog.revision
    }) || due(targets, now, Duration::days(14));
    let mut new_targets_link = None;
    if sign_new_targets || !options.icons.is_empty() {
        let entries = prepare_targets(catalog, bytes, files, state, options.icons)?;
        if sign_new_targets {
            let (version, expires) = fields(targets, now, Duration::days(90))?;
            let signed = sign_targets(root, keys, version, expires, &entries)?;
            new_targets_link = Some(MetaLink::from_bytes(version, &signed));
            files.insert(version_path(Role::Targets, version), signed);
        }
    }

    let sign_new_snapshot = sign_new_targets || due(snapshot, now, Duration::days(2));
    let mut new_snapshot_link = None;
    if sign_new_snapshot {
        let targets_link = new_targets_link
            .as_ref()
            .or_else(|| state.map(|state| &state.targets_link))
            .ok_or_else(|| CatalogError::new("Missing targets metadata"))?;
        let (version, expires) = fields(snapshot, now, Duration::days(7))?;
        let signed = sign_link(Role::Snapshot, root, keys, version, expires, targets_link)?;
        new_snapshot_link = Some(MetaLink::from_bytes(version, &signed));
        files.insert(version_path(Role::Snapshot, version), signed);
    }

    if sign_new_snapshot || due(timestamp, now, Duration::hours(12)) {
        let snapshot_link = new_snapshot_link
            .as_ref()
            .or_else(|| state.map(|state| &state.snapshot_link))
            .ok_or_else(|| CatalogError::new("Missing snapshot metadata"))?;
        let (version, expires) = fields(timestamp, now, Duration::days(1))?;
        let signed = sign_link(Role::Timestamp, root, keys, version, expires, snapshot_link)?;
        files.insert(TIMESTAMP_PATH.into(), signed);
    }

    Ok(())
}

fn due(role: Option<&Online>, now: OffsetDateTime, window: Duration) -> bool {
    role.is_none_or(|role| role.expires - now <= window)
}

fn fields(
    role: Option<&Online>,
    now: OffsetDateTime,
    lifetime: Duration,
) -> Result<(u64, OffsetDateTime)> {
    let version = next_version(role.map_or(0, |role| role.version))?;
    let expires = now
        .checked_add(lifetime)
        .ok_or_else(|| CatalogError::new("Invalid metadata expiry"))?;
    Ok((version, expires))
}
