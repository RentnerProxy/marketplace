use std::collections::{BTreeMap, BTreeSet};

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey, pkcs8::DecodePrivateKey};
use serde::Deserialize;
use serde_json::{Value, json};
use time::OffsetDateTime;

use super::{Envelope, Role, canonical, hex_bytes, is_lower_hex};
use crate::{CatalogError, Result};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireRole {
    keyids: Vec<String>,
    threshold: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireKey {
    keytype: String,
    scheme: String,
    keyval: KeyValue,
    #[serde(default)]
    keyid_hash_algorithms: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyValue {
    public: String,
}

#[derive(Debug)]
struct DelegatedKeys {
    threshold: usize,
    by_id: BTreeMap<String, VerifyingKey>,
}

#[derive(Debug)]
pub(crate) struct Root {
    pub(crate) version: u64,
    pub(crate) expires: OffsetDateTime,
    roles: BTreeMap<Role, DelegatedKeys>,
}

impl Root {
    pub(crate) fn parse(bytes: &[u8], previous: Option<&Root>) -> Result<Self> {
        let env = Envelope::parse(bytes, Role::Root)?;
        if env.signed["consistent_snapshot"] != true {
            return Err(CatalogError::new("Consistent snapshots required"));
        }
        if let Some(previous) = previous
            && env.version != previous.version + 1
        {
            return Err(CatalogError::new("Nonsequential root rotation"));
        }
        let message = canonical(&env.signed)?;
        if let Some(previous) = previous {
            previous.verify(Role::Root, &message, &env.signatures)?;
        }
        let roles = read_role_keys(&env.signed)?;
        let root = Self {
            version: env.version,
            expires: env.expires,
            roles,
        };
        root.verify(Role::Root, &message, &env.signatures)?;
        Ok(root)
    }

    pub(super) fn verify(
        &self,
        role: Role,
        message: &[u8],
        signatures: &BTreeMap<String, Signature>,
    ) -> Result<()> {
        let authorized = &self.roles[&role];
        let mut valid = 0;
        for (id, public) in &authorized.by_id {
            if let Some(signature) = signatures.get(id)
                && public.verify_strict(message, signature).is_ok()
            {
                valid += 1;
                if valid == authorized.threshold {
                    return Ok(());
                }
            }
        }
        Err(CatalogError::new(format!(
            "{} was signed by {valid} authorized keys, requires {}",
            role.as_str(),
            authorized.threshold
        )))
    }
}

fn read_role_keys(signed: &Value) -> Result<BTreeMap<Role, DelegatedKeys>> {
    let role_specs = BTreeMap::<Role, WireRole>::deserialize(&signed["roles"])
        .map_err(|_| CatalogError::new("Invalid root roles"))?;
    if role_specs.len() != 4 {
        return Err(CatalogError::new("Missing root role"));
    }
    let mut keys = BTreeMap::<String, WireKey>::deserialize(&signed["keys"])
        .map_err(|_| CatalogError::new("Invalid root key descriptors"))?;
    let mut seen_keys = BTreeSet::new();
    let mut roles = BTreeMap::new();
    for (role, spec) in role_specs {
        if spec.threshold == 0 || spec.threshold > spec.keyids.len() {
            return Err(CatalogError::new("Invalid role threshold"));
        }
        let mut by_id = BTreeMap::new();
        for id in spec.keyids {
            let key = keys
                .remove(&id)
                .ok_or_else(|| CatalogError::new("Missing or reused Ed25519 role key ID"))?;
            if !is_lower_hex(&id, 64) || key.keytype != "ed25519" || key.scheme != "ed25519" {
                return Err(CatalogError::new("Invalid Ed25519 role key"));
            }
            // Legacy TUF key descriptors may name the algorithms used to compute
            // their IDs. The original field is covered by the root signatures.
            // ASCII names also avoid NFC-induced differences from the JS signer.
            if key.keyid_hash_algorithms.iter().any(|algorithm| {
                algorithm.is_empty()
                    || !algorithm
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            }) {
                return Err(CatalogError::new("Invalid key ID hash algorithm name"));
            }
            let raw = hex_bytes(&key.keyval.public)?;
            let public = VerifyingKey::from_bytes(&raw)
                .map_err(|_| CatalogError::new("Invalid Ed25519 public key"))?;
            if public.is_weak() || public.to_edwards().compress().to_bytes() != raw {
                return Err(CatalogError::new("Weak or noncanonical Ed25519 public key"));
            }
            if !seen_keys.insert(raw) {
                return Err(CatalogError::new("Invalid or reused Ed25519 role key"));
            }
            by_id.insert(id, public);
        }
        roles.insert(
            role,
            DelegatedKeys {
                threshold: spec.threshold,
                by_id,
            },
        );
    }
    if !keys.is_empty() {
        return Err(CatalogError::new("Unexpected root key"));
    }
    Ok(roles)
}

#[derive(Default, Debug)]
pub(crate) struct KeyHistory {
    roles_by_public_key: BTreeMap<[u8; 32], Role>,
    public_keys_by_id: BTreeMap<String, [u8; 32]>,
}

impl KeyHistory {
    pub(crate) fn validate(&self, root: &Root) -> Result<()> {
        for (role, authorized) in &root.roles {
            for (id, key) in &authorized.by_id {
                if self
                    .roles_by_public_key
                    .get(key.as_bytes())
                    .is_some_and(|seen| seen != role)
                {
                    return Err(CatalogError::new(
                        "Root rotation reassigns a key across roles",
                    ));
                }
                if self
                    .public_keys_by_id
                    .get(id)
                    .is_some_and(|seen| seen != key.as_bytes())
                {
                    return Err(CatalogError::new("Root rotation reuses a key ID"));
                }
            }
        }
        Ok(())
    }

    pub(crate) fn record(&mut self, root: &Root) -> Result<()> {
        self.validate(root)?;
        for (role, authorized) in &root.roles {
            for (id, key) in &authorized.by_id {
                self.roles_by_public_key.insert(key.to_bytes(), *role);
                self.public_keys_by_id.insert(id.clone(), key.to_bytes());
            }
        }
        Ok(())
    }
}

/// Online Ed25519 credentials for publishing the three top-level catalog roles.
pub struct SigningKeys {
    targets: SigningKey,
    snapshot: SigningKey,
    timestamp: SigningKey,
}

impl SigningKeys {
    /// Loads unencrypted Ed25519 PKCS#8 PEM keys. Root keys stay offline.
    pub fn from_pem(targets: &str, snapshot: &str, timestamp: &str) -> Result<Self> {
        fn parse(pem: &str) -> Result<SigningKey> {
            if pem.len() > 4096 {
                return Err(CatalogError::new("Oversized Ed25519 signing key"));
            }
            SigningKey::from_pkcs8_pem(pem)
                .map_err(|_| CatalogError::new("Invalid Ed25519 PKCS#8 signing key"))
        }
        Ok(Self {
            targets: parse(targets)?,
            snapshot: parse(snapshot)?,
            timestamp: parse(timestamp)?,
        })
    }

    pub(super) fn sign(&self, root: &Root, role: Role, message: &[u8]) -> Result<Value> {
        let key = match role {
            Role::Targets => &self.targets,
            Role::Snapshot => &self.snapshot,
            Role::Timestamp => &self.timestamp,
            Role::Root => return Err(CatalogError::new("Root keys must remain offline")),
        };
        let authorized = &root.roles[&role];
        let public = key.verifying_key();
        let (id, _) = authorized
            .by_id
            .iter()
            .find(|(_, allowed)| **allowed == public)
            .ok_or_else(|| {
                CatalogError::new(format!(
                    "Signing key is not authorized for {}",
                    role.as_str()
                ))
            })?;
        let signature = key.sign(message);
        root.verify(role, message, &BTreeMap::from([(id.clone(), signature)]))?;
        Ok(json!({"keyid": id, "sig": hex::encode(signature.to_bytes())}))
    }
}
