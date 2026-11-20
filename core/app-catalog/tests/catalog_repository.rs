use std::collections::BTreeMap;

use ed25519_dalek::{Signer, SigningKey, pkcs8::EncodePrivateKey};
use marketplace_app_catalog::{
    ReadOptions, Result, SigningKeys, TrustedCatalog, UpdateOptions, bootstrap_catalog,
    read_catalog, read_package_catalog, update_catalog,
};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};

type Files = BTreeMap<String, Vec<u8>>;

const TIMESTAMP: &str = "metadata/timestamp.json";
const ICON: &[u8] = b"approved fixture icon";

fn now() -> OffsetDateTime {
    OffsetDateTime::parse("2026-11-01T12:00:00Z", &Rfc3339).unwrap()
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

struct Credentials {
    root: [SigningKey; 2],
    online: [SigningKey; 3],
}

impl Credentials {
    fn new(seed: u8) -> Self {
        let key = |n| SigningKey::from_bytes(&[seed + n; 32]);
        Self {
            root: [key(0), key(1)],
            online: [key(2), key(3), key(4)],
        }
    }

    fn online(&self) -> SigningKeys {
        let [targets, snapshot, timestamp] = self
            .online
            .each_ref()
            .map(|key| key.to_pkcs8_pem(Default::default()).unwrap());
        SigningKeys::from_pem(&targets, &snapshot, &timestamp).unwrap()
    }

    fn root(&self, at: OffsetDateTime, version: u64, signers: &[&SigningKey]) -> Vec<u8> {
        let mut keys = BTreeMap::new();
        let mut roles = BTreeMap::new();
        let role_keys = [
            ("root", self.root.as_slice()),
            ("targets", &self.online[0..1]),
            ("snapshot", &self.online[1..2]),
            ("timestamp", &self.online[2..3]),
        ];
        for (role, signers) in role_keys {
            let mut ids = Vec::new();
            for signer in signers {
                let descriptor = descriptor(signer);
                let id = sha256(&canonical(&descriptor));
                ids.push(id.clone());
                keys.insert(id, descriptor);
            }
            roles.insert(role, json!({"keyids": ids, "threshold": ids.len()}));
        }
        let signed = json!({
            "_type": "root", "version": version, "spec_version": "1.0.0",
            "expires": (at + Duration::days(365)).format(&Rfc3339).unwrap(),
            "consistent_snapshot": true, "keys": keys, "roles": roles,
        });
        signed_metadata(&signed, signers)
    }
}

fn signed_metadata(signed: &Value, signers: &[&SigningKey]) -> Vec<u8> {
    let message = canonical(signed);
    let signatures: Vec<_> = signers
        .iter()
        .map(|key| {
            json!({
                "keyid": sha256(&canonical(&descriptor(key))),
                "sig": hex::encode(key.sign(&message).to_bytes()),
            })
        })
        .collect();
    serde_json::to_vec(&json!({"signed": signed, "signatures": signatures})).unwrap()
}

fn descriptor(key: &SigningKey) -> Value {
    json!({"keytype": "ed25519", "scheme": "ed25519", "keyval": {"public": hex::encode(key.verifying_key().as_bytes())}})
}

fn canonical(value: &Value) -> Vec<u8> {
    let formatter = olpc_cjson::CanonicalFormatter::new();
    let mut bytes = Vec::new();
    value
        .serialize(&mut serde_json::Serializer::with_formatter(
            &mut bytes, formatter,
        ))
        .unwrap();
    bytes
}

fn options(at: OffsetDateTime) -> ReadOptions<'static> {
    ReadOptions {
        now: at,
        allow_expired_roles: false,
        next_root: None,
        previous: None,
    }
}

fn read(files: &Files, root: &[u8], options: ReadOptions<'_>) -> Result<TrustedCatalog> {
    read_catalog(|path, _| Ok(files.get(path).cloned()), root, options)
}

fn repository() -> (Credentials, Vec<u8>, Files, TrustedCatalog) {
    let credentials = Credentials::new(1);
    let root = credentials.root(now(), 1, &credentials.root.each_ref());
    let files = bootstrap_catalog(&root, &credentials.online(), now()).unwrap();
    let state = read(&files, &root, options(now())).unwrap();
    (credentials, root, files, state)
}

fn reject<T>(result: Result<T>, message: &str) {
    let error = match result {
        Ok(_) => panic!("expected rejection containing {message}"),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains(message),
        "unexpected error: {error}"
    );
}

fn release_catalog() -> Value {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../contracts/v1/fixtures.json")).unwrap();
    let mut release = fixture["records"]["release"].clone();
    release["icon"] = json!({"format": "png", "sha256": sha256(ICON), "sizeBytes": ICON.len()});
    release["packages"] = Value::Array(
        fixture["targets"]
            .as_array()
            .unwrap()
            .iter()
            .cloned()
            .map(|mut package| {
                let target = package.as_object_mut().unwrap().remove("target").unwrap();
                let mut manifest = fixture["manifest"].clone();
                manifest["target"] = target;
                package["manifest"] = manifest;
                package
            })
            .collect(),
    );
    json!({"formatVersion": 1, "revision": 2, "releases": [release], "revocations": []})
}

fn update(
    state: &TrustedCatalog,
    candidate: &Value,
    keys: &SigningKeys,
    icons: &Files,
) -> Result<Files> {
    update_catalog(
        state,
        &serde_json::to_vec(candidate).unwrap(),
        keys,
        UpdateOptions {
            now: now(),
            next_root: None,
            icons,
        },
    )
}

#[test]
fn repinning_preserves_retired_key_assignments_across_later_rotations() {
    let (first, root1, mut files, initial) = repository();
    let second = Credentials::new(21);
    let mut signers = first.root.each_ref().to_vec();
    signers.extend(second.root.each_ref());
    let root2 = second.root(now(), 2, &signers);
    files.extend(
        update_catalog(
            &initial,
            initial.catalog_bytes(),
            &second.online(),
            UpdateOptions {
                now: now(),
                next_root: Some(&root2),
                icons: &Files::new(),
            },
        )
        .unwrap(),
    );
    let rotated = read(&files, &root1, options(now())).unwrap();
    let repinned = read(
        &files,
        &root2,
        ReadOptions {
            previous: Some(&rotated),
            ..options(now())
        },
    )
    .unwrap();

    let mut third = Credentials::new(41);
    third.online[0] = first.online[2].clone();
    let mut signers = second.root.each_ref().to_vec();
    signers.extend(third.root.each_ref());
    let root3 = third.root(now(), 3, &signers);
    let reason = "reassigns a key across roles";
    reject(
        update_catalog(
            &repinned,
            repinned.catalog_bytes(),
            &third.online(),
            UpdateOptions {
                now: now(),
                next_root: Some(&root3),
                icons: &Files::new(),
            },
        ),
        reason,
    );
    files.insert("metadata/3.root.json".into(), root3);
    reject(
        read(
            &files,
            &root2,
            ReadOptions {
                previous: Some(&repinned),
                ..options(now())
            },
        ),
        reason,
    );
}

#[test]
fn publisher_checks_every_online_credential_even_when_nothing_is_due() {
    let (mut keys, _, _, state) = repository();
    for (index, name) in ["targets", "snapshot", "timestamp"].iter().enumerate() {
        let replacement = SigningKey::from_bytes(&[99; 32]);
        let original = std::mem::replace(&mut keys.online[index], replacement);
        reject(
            update_catalog(
                &state,
                state.catalog_bytes(),
                &keys.online(),
                UpdateOptions {
                    now: now(),
                    next_root: None,
                    icons: &Files::new(),
                },
            ),
            &format!("Signing key is not authorized for {name}"),
        );
        keys.online[index] = original;
    }
}

#[test]
fn readers_accept_multisigned_online_roles_that_the_publisher_cannot_renew() {
    let (keys, root1, mut files, initial) = repository();
    let second_timestamp = SigningKey::from_bytes(&[92; 32]);
    let extra = descriptor(&second_timestamp);
    let extra_id = sha256(&canonical(&extra));
    let mut root: Value = serde_json::from_slice(&root1).unwrap();
    let signed = &mut root["signed"];
    signed["version"] = 2.into();
    signed["roles"]["timestamp"]["keyids"]
        .as_array_mut()
        .unwrap()
        .push(extra_id.clone().into());
    signed["roles"]["timestamp"]["threshold"] = 2.into();
    signed["keys"][&extra_id] = extra;
    let root2 = signed_metadata(signed, &keys.root.each_ref());
    let reason = "Publisher requires a threshold of one for timestamp";
    reject(
        update_catalog(
            &initial,
            initial.catalog_bytes(),
            &keys.online(),
            UpdateOptions {
                now: now(),
                next_root: Some(&root2),
                icons: &Files::new(),
            },
        ),
        reason,
    );

    let timestamp: Value = serde_json::from_slice(&files[TIMESTAMP]).unwrap();
    let timestamp = signed_metadata(&timestamp["signed"], &[&keys.online[2], &second_timestamp]);
    files.insert(TIMESTAMP.into(), timestamp);
    files.insert("metadata/2.root.json".into(), root2);
    let verified = read(&files, &root1, options(now())).unwrap();
    reject(
        update_catalog(
            &verified,
            verified.catalog_bytes(),
            &keys.online(),
            UpdateOptions {
                now: now(),
                next_root: None,
                icons: &Files::new(),
            },
        ),
        reason,
    );
}

#[test]
fn verifies_consistent_targets_and_preserves_tombstones() {
    let (credentials, root, mut files, state) = repository();
    let keys = credentials.online();
    let mut candidate = release_catalog();
    let digest = sha256(ICON);
    let icon_name = format!("assets/{digest}.png");
    let icon_path = format!("targets/assets/{digest}.{digest}.png");
    let mut icons = Files::from([(icon_name, vec![0; ICON.len()])]);
    reject(
        update(&state, &candidate, &keys, &Files::new()),
        "Missing approved icon bytes",
    );
    reject(
        update(&state, &candidate, &keys, &icons),
        "Supplied icon bytes",
    );
    *icons.values_mut().next().unwrap() = ICON.to_vec();
    let changes = update(&state, &candidate, &keys, &icons).unwrap();
    assert_eq!(changes[&icon_path], ICON);
    files.extend(changes);
    let checked = read(
        &files,
        &root,
        ReadOptions {
            previous: Some(&state),
            ..options(now())
        },
    )
    .unwrap();
    assert_eq!(
        checked.catalog_bytes(),
        serde_json::to_vec(&candidate).unwrap()
    );
    assert!(
        update(&checked, &candidate, &keys, &icons)
            .unwrap()
            .is_empty()
    );
    reject(
        update(
            &checked,
            &candidate,
            &keys,
            &Files::from([("assets/unlisted.png".into(), vec![0])]),
        ),
        "Unexpected supplied icon",
    );

    files.get_mut(&icon_path).unwrap()[0] ^= 1;
    reject(read(&files, &root, options(now())), "Target bytes differ");
    files.insert(icon_path, ICON.to_vec());

    let removed = candidate["releases"][0].clone();
    candidate["releases"] = json!([]);
    reject(
        update(&checked, &candidate, &keys, &Files::new()),
        "revision",
    );
    candidate["revision"] = 3.into();
    reject(
        update(&checked, &candidate, &keys, &Files::new()),
        "changed without a revocation",
    );
    candidate["revocations"] = json!([{
        "appId": removed["appId"], "version": removed["version"],
        "revokedAt": "2026-11-01T12:00:00.000Z", "reason": "security",
    }]);
    files.extend(update(&checked, &candidate, &keys, &Files::new()).unwrap());
    let revoked = read(
        &files,
        &root,
        ReadOptions {
            previous: Some(&checked),
            ..options(now())
        },
    )
    .unwrap();
    candidate["revision"] = 4.into();
    candidate["revocations"][0]["reason"] = "withdrawn".into();
    reject(
        update(&revoked, &candidate, &keys, &Files::new()),
        "Existing revocation changed",
    );
}

#[test]
fn package_reader_checks_the_signed_chain_without_fetching_icon_contents() {
    let (credentials, root, mut files, state) = repository();
    let bootstrap = files.clone();
    let catalog = release_catalog();
    let hash = sha256(ICON);
    let name = format!("assets/{hash}.png");
    let path = format!("targets/assets/{hash}.{hash}.png");
    let icons = Files::from([(name.clone(), ICON.to_vec())]);
    files.extend(update(&state, &catalog, &credentials.online(), &icons).unwrap());
    files.remove(&path).unwrap();
    reject(
        read(&files, &root, options(now())),
        "Missing or oversized catalog file",
    );

    let package_reader = |path: &str, _| {
        assert!(!path.starts_with("targets/assets/"));
        Ok(files.get(path).cloned())
    };
    let trusted = read_package_catalog(package_reader, &root, now(), None).unwrap();
    assert_eq!(
        trusted.catalog_bytes(),
        serde_json::to_vec(&catalog).unwrap()
    );
    read_package_catalog(package_reader, &root, now(), Some(&trusted)).unwrap();
    reject(
        read_package_catalog(package_reader, &root, now() + Duration::days(2), None),
        "Invalid or expired timestamp",
    );
    reject(
        read_package_catalog(
            |path, _| Ok(bootstrap.get(path).cloned()),
            &root,
            now(),
            Some(&trusted),
        ),
        "Metadata rollback",
    );

    let targets_path = "metadata/2.targets.json";
    let snapshot_path = "metadata/2.snapshot.json";
    let mut targets: Value = serde_json::from_slice(&files[targets_path]).unwrap();
    targets["signed"]["targets"][&name]["length"] = (ICON.len() + 1).into();
    let targets = signed_metadata(&targets["signed"], &[&credentials.online[0]]);
    let link = |bytes: &[u8]| json!({"version": 2, "length": bytes.len(), "hashes": {"sha256": sha256(bytes)}});
    let mut snapshot: Value = serde_json::from_slice(&files[snapshot_path]).unwrap();
    snapshot["signed"]["meta"]["targets.json"] = link(&targets);
    let snapshot = signed_metadata(&snapshot["signed"], &[&credentials.online[1]]);
    let mut timestamp: Value = serde_json::from_slice(&files[TIMESTAMP]).unwrap();
    timestamp["signed"]["meta"]["snapshot.json"] = link(&snapshot);
    let timestamp = signed_metadata(&timestamp["signed"], &[&credentials.online[2]]);
    files.insert(targets_path.into(), targets);
    files.insert(snapshot_path.into(), snapshot);
    files.insert(TIMESTAMP.into(), timestamp);
    reject(
        read_package_catalog(|path, _| Ok(files.get(path).cloned()), &root, now(), None),
        "Signed icon identity differs",
    );
}

#[test]
fn refreshes_due_roles_and_rejects_rollback_or_metadata_version_reuse() {
    let (credentials, root, files, state) = repository();
    let keys = credentials.online();
    let refresh = |at| {
        update_catalog(
            &state,
            state.catalog_bytes(),
            &keys,
            UpdateOptions {
                now: at,
                next_root: None,
                icons: &Files::new(),
            },
        )
        .unwrap()
    };
    assert!(refresh(now() + Duration::hours(11)).is_empty());
    assert_eq!(
        refresh(now() + Duration::hours(12))
            .into_keys()
            .collect::<Vec<_>>(),
        [TIMESTAMP]
    );
    assert_eq!(
        refresh(now() + Duration::days(5))
            .into_keys()
            .collect::<Vec<_>>(),
        ["metadata/2.snapshot.json", TIMESTAMP]
    );
    let fully_due = now() + Duration::days(76);
    let changes = refresh(fully_due);
    assert_eq!(
        changes.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "metadata/2.snapshot.json",
            "metadata/2.targets.json",
            TIMESTAMP
        ]
    );
    let mut latest = files.clone();
    latest.extend(changes);
    let updated = read(
        &latest,
        &root,
        ReadOptions {
            previous: Some(&state),
            ..options(fully_due)
        },
    )
    .unwrap();
    reject(
        read(
            &files,
            &root,
            ReadOptions {
                previous: Some(&updated),
                ..options(now())
            },
        ),
        "rollback",
    );

    let later = now() + Duration::hours(1);
    let reused = bootstrap_catalog(&root, &keys, later).unwrap();
    reject(
        read(
            &reused,
            &root,
            ReadOptions {
                previous: Some(&state),
                ..options(later)
            },
        ),
        "version reuse: timestamp",
    );
    reject(read(&files, &root, options(fully_due)), "expired timestamp");
    assert!(
        read(
            &files,
            &root,
            ReadOptions {
                allow_expired_roles: true,
                ..options(fully_due)
            }
        )
        .is_ok()
    );

    for path in ["metadata/2.snapshot.json", "metadata/2.targets.json"] {
        let mut changed = latest.clone();
        changed.get_mut(path).unwrap()[0] ^= 1;
        reject(read(&changed, &root, options(fully_due)), "bytes differ");
    }
}

#[test]
fn fresh_metadata_cannot_reuse_or_roll_back_a_catalog_revision() {
    let (credentials, root, initial, state) = repository();
    let keys = credentials.online();
    let icons = Files::new();
    let opts = UpdateOptions {
        now: now(),
        next_root: None,
        icons: &icons,
    };
    let alternative_empty = br#"{"revision":1.0,"releases":[],"revocations":[],"formatVersion":1}"#;
    assert!(
        update_catalog(&state, alternative_empty, &keys, UpdateOptions { ..opts })
            .unwrap()
            .is_empty()
    );
    reject(
        update_catalog(
            &state,
            br#"{"revision":1,"revision":1,"releases":[],"revocations":[],"formatVersion":1}"#,
            &keys,
            UpdateOptions { ..opts },
        ),
        "ambiguous catalog JSON",
    );

    let mut candidate = release_catalog();
    candidate["releases"][0]
        .as_object_mut()
        .unwrap()
        .remove("icon");
    let mut accepted = initial.clone();
    accepted.extend(update(&state, &candidate, &keys, &icons).unwrap());
    let checkpoint = read(&accepted, &root, options(now())).unwrap();

    let mut alternative = initial.clone();
    let different_bytes = serde_json::to_vec_pretty(&candidate).unwrap();
    alternative.extend(update_catalog(&state, &different_bytes, &keys, opts).unwrap());
    let competing = read(&alternative, &root, options(now())).unwrap();
    assert_eq!(competing.catalog_bytes(), different_bytes);
    let refresh = |files: &mut Files, state: &TrustedCatalog, at| {
        files.extend(
            update_catalog(
                state,
                state.catalog_bytes(),
                &keys,
                UpdateOptions {
                    now: at,
                    next_root: None,
                    icons: &icons,
                },
            )
            .unwrap(),
        );
    };
    let due = now() + Duration::days(76);
    refresh(&mut alternative, &competing, due);
    reject(
        read(
            &alternative,
            &root,
            ReadOptions {
                previous: Some(&checkpoint),
                ..options(due)
            },
        ),
        "Catalog rollback or revision reuse",
    );

    let mut stale = initial;
    refresh(&mut stale, &state, due);
    let renewed = read(&stale, &root, options(due)).unwrap();
    let later = due + Duration::days(76);
    refresh(&mut stale, &renewed, later);
    reject(
        read(
            &stale,
            &root,
            ReadOptions {
                previous: Some(&checkpoint),
                ..options(later)
            },
        ),
        "Catalog rollback or revision reuse",
    );
}

#[test]
fn authenticates_expired_root_recovery_and_checks_exact_root_history() {
    let (old, root, mut files, state) = repository();
    let mut altered = files.clone();
    altered.get_mut("metadata/1.root.json").unwrap().push(b' ');
    reject(
        read(&altered, &root, options(now())),
        "differs from pinned root",
    );

    let new = Credentials::new(21);
    let old_signers = old.root.each_ref();
    let new_signers = new.root.each_ref();
    let both = [
        old_signers[0],
        old_signers[1],
        new_signers[0],
        new_signers[1],
    ];
    let later = now() + Duration::days(366);
    let fresh_root = new.root(later, 2, &both);
    let cross_role = Credentials {
        root: new.root.clone(),
        online: [
            old.online[2].clone(),
            new.online[1].clone(),
            new.online[2].clone(),
        ],
    };
    let recovery = ReadOptions {
        now: later,
        allow_expired_roles: true,
        next_root: None,
        previous: Some(&state),
    };
    reject(
        read(&files, &root, ReadOptions { ..recovery }),
        "Expired root",
    );
    reject(
        read(
            &files,
            &root,
            ReadOptions {
                next_root: Some(&fresh_root),
                ..options(later)
            },
        ),
        "Expired root",
    );
    for (bad_root, reason) in [
        (new.root(later, 3, &both), "Nonsequential"),
        (new.root(later, 2, &new_signers), "authorized"),
        (new.root(later, 2, &old_signers), "authorized"),
        (new.root(now(), 2, &both), "Expired replacement root"),
        (cross_role.root(later, 2, &both), "reassigns a key"),
    ] {
        reject(
            read(
                &files,
                &root,
                ReadOptions {
                    next_root: Some(&bad_root),
                    ..recovery
                },
            ),
            reason,
        );
    }

    let saved = read(
        &files,
        &root,
        ReadOptions {
            next_root: Some(&fresh_root),
            ..recovery
        },
    )
    .unwrap();
    let icons = Files::new();
    let opts = |next_root| UpdateOptions {
        now: later,
        next_root,
        icons: &icons,
    };
    reject(
        update_catalog(&saved, saved.catalog_bytes(), &old.online(), opts(None)),
        "Expired root",
    );
    reject(
        update_catalog(
            &saved,
            saved.catalog_bytes(),
            &old.online(),
            opts(Some(&fresh_root)),
        ),
        "authorized",
    );
    let changes = update_catalog(
        &saved,
        saved.catalog_bytes(),
        &new.online(),
        opts(Some(&fresh_root)),
    )
    .unwrap();
    assert_eq!(
        changes.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "metadata/2.root.json",
            "metadata/2.snapshot.json",
            "metadata/2.targets.json",
            TIMESTAMP
        ]
    );
    let mut mixed = files.clone();
    mixed.insert(TIMESTAMP.into(), changes[TIMESTAMP].clone());
    reject(
        read(
            &mixed,
            &root,
            ReadOptions {
                next_root: Some(&fresh_root),
                ..recovery
            },
        ),
        "timestamp was signed by 0",
    );

    files.extend(changes);
    let rotated = read(
        &files,
        &root,
        ReadOptions {
            previous: Some(&saved),
            ..options(later)
        },
    )
    .unwrap();
    assert_eq!(rotated.catalog_bytes(), saved.catalog_bytes());
    reject(
        read(
            &mixed,
            &root,
            ReadOptions {
                previous: Some(&rotated),
                ..options(later)
            },
        ),
        "version reuse: root",
    );
    assert!(
        update_catalog(
            &rotated,
            rotated.catalog_bytes(),
            &new.online(),
            opts(Some(&fresh_root))
        )
        .unwrap()
        .is_empty()
    );

    files.get_mut("metadata/2.root.json").unwrap().push(b' ');
    reject(
        read(
            &files,
            &root,
            ReadOptions {
                previous: Some(&rotated),
                ..options(later)
            },
        ),
        "Root history differs from trusted checkpoint",
    );
}
