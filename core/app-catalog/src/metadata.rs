mod json;
mod root;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use ed25519_dalek::Signature;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};

use self::json::canonical;
pub(crate) use self::json::decode;
use crate::{CatalogError, Result};
pub use root::SigningKeys;
pub(crate) use root::{KeyHistory, Root};

pub(crate) const MAX_SAFE_VERSION: u64 = (1 << 53) - 1;
pub(crate) const CATALOG_LIMIT: usize = 16 * 1024 * 1024;
const ICON_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Role {
    Root,
    Targets,
    Snapshot,
    Timestamp,
}

impl Role {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Root => "root",
            Self::Targets => "targets",
            Self::Snapshot => "snapshot",
            Self::Timestamp => "timestamp",
        }
    }

    pub(crate) fn limit(self) -> usize {
        match self {
            Self::Root => 512 * 1024,
            Self::Targets => 4 * 1024 * 1024,
            Self::Snapshot => 128 * 1024,
            Self::Timestamp => 32 * 1024,
        }
    }

    fn child(self) -> Result<(&'static str, Role)> {
        match self {
            Self::Timestamp => Ok(("snapshot.json", Self::Snapshot)),
            Self::Snapshot => Ok(("targets.json", Self::Targets)),
            _ => Err(CatalogError::new("Expected a metadata link role")),
        }
    }
}

pub(crate) fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn is_lower_hex(value: &str, digits: usize) -> bool {
    value.len() == digits
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn hex_bytes<const N: usize>(value: &str) -> Result<[u8; N]> {
    let mut bytes = [0; N];
    if !is_lower_hex(value, N * 2) || hex::decode_to_slice(value, &mut bytes).is_err() {
        return Err(CatalogError::new("Invalid TUF hexadecimal encoding"));
    }
    Ok(bytes)
}

fn fields<'a>(value: &'a Value, names: &[&str]) -> Result<&'a Map<String, Value>> {
    value
        .as_object()
        .filter(|object| {
            object.len() == names.len() && names.iter().all(|name| object.contains_key(*name))
        })
        .ok_or_else(|| CatalogError::new("Unexpected or missing TUF metadata fields"))
}

fn version(value: &Value) -> Result<u64> {
    value
        .as_u64()
        .filter(|v| (1..=MAX_SAFE_VERSION).contains(v))
        .ok_or_else(|| CatalogError::new("Invalid metadata version"))
}

fn expires_string(time: OffsetDateTime) -> Result<String> {
    time.to_offset(UtcOffset::UTC)
        .replace_nanosecond(0)
        .map_err(|_| CatalogError::new("Invalid metadata expiry"))?
        .format(&Rfc3339)
        .map_err(|_| CatalogError::new("Invalid metadata expiry"))
}

fn supported_spec(value: &Value) -> bool {
    let Some(spec) = value.as_str() else {
        return false;
    };
    let mut parts = spec.split('.');
    let numeric = |v: &str| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit());
    parts.next() == Some("1")
        && parts.next().is_some_and(numeric)
        && parts.next().is_none_or(numeric)
        && parts.next().is_none()
}

struct Envelope {
    signed: Value,
    signatures: BTreeMap<String, Signature>,
    version: u64,
    expires: OffsetDateTime,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireEnvelope {
    signed: Value,
    signatures: Vec<WireSignature>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireSignature {
    keyid: String,
    sig: String,
}

impl Envelope {
    fn parse(bytes: &[u8], role: Role) -> Result<Self> {
        if bytes.is_empty() || bytes.len() > role.limit() {
            return Err(CatalogError::new("Empty or oversized TUF metadata"));
        }
        let WireEnvelope { signed, signatures } = serde_json::from_value(decode(bytes)?)
            .map_err(|_| CatalogError::new("Invalid TUF envelope"))?;
        let role_fields: &[&str] = match role {
            Role::Root => &[
                "_type",
                "spec_version",
                "version",
                "expires",
                "consistent_snapshot",
                "keys",
                "roles",
            ],
            Role::Targets => &["_type", "spec_version", "version", "expires", "targets"],
            Role::Snapshot | Role::Timestamp => {
                &["_type", "spec_version", "version", "expires", "meta"]
            }
        };
        fields(&signed, role_fields)?;
        if signed["_type"].as_str() != Some(role.as_str())
            || !supported_spec(&signed["spec_version"])
        {
            return Err(CatalogError::new(
                "Unexpected TUF role or specification version",
            ));
        }
        let version = version(&signed["version"])?;
        let expiry = signed["expires"]
            .as_str()
            .filter(|v| v.len() == 20)
            .ok_or_else(|| CatalogError::new("Invalid metadata expiry"))?;
        let expires = OffsetDateTime::parse(expiry, &Rfc3339)
            .map_err(|_| CatalogError::new("Invalid metadata expiry"))?;
        if expires_string(expires)? != expiry {
            return Err(CatalogError::new("Invalid metadata expiry"));
        }
        let mut unique = BTreeMap::new();
        for signature in signatures {
            let sig = Signature::from_bytes(&hex_bytes(&signature.sig)?);
            if !is_lower_hex(&signature.keyid, 64) || unique.insert(signature.keyid, sig).is_some()
            {
                return Err(CatalogError::new("Invalid or duplicate signature key ID"));
            }
        }
        Ok(Self {
            signed,
            signatures: unique,
            version,
            expires,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FileInfo {
    pub(crate) length: usize,
    pub(crate) sha256: String,
}

impl FileInfo {
    pub(crate) fn from_bytes(bytes: &[u8]) -> Self {
        Self {
            length: bytes.len(),
            sha256: digest(bytes),
        }
    }

    pub(crate) fn validate(&self, limit: usize) -> Result<()> {
        if self.length == 0 || self.length > limit || !is_lower_hex(&self.sha256, 64) {
            return Err(CatalogError::new(
                "Invalid signed metadata length or SHA-256",
            ));
        }
        Ok(())
    }

    pub(crate) fn verify(&self, bytes: &[u8], limit: usize) -> Result<()> {
        self.validate(limit)?;
        if bytes.len() != self.length || digest(bytes) != self.sha256 {
            return Err(CatalogError::new(
                "Target bytes differ from signed length or SHA-256",
            ));
        }
        Ok(())
    }

    fn parse(value: &Value, limit: usize) -> Result<Self> {
        let hashes = fields(&value["hashes"], &["sha256"])?;
        let sha256 = hashes["sha256"]
            .as_str()
            .ok_or_else(|| CatalogError::new("Invalid signed SHA-256"))?;
        let length = value["length"]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| CatalogError::new("Invalid signed byte length"))?;
        let file = Self {
            length,
            sha256: sha256.to_owned(),
        };
        file.validate(limit)?;
        Ok(file)
    }

    fn wire(&self) -> Value {
        json!({"length": self.length, "hashes": {"sha256": self.sha256}})
    }
}

#[derive(Clone, Debug)]
pub(crate) struct MetaLink {
    pub(crate) version: u64,
    pub(crate) file: FileInfo,
}

impl MetaLink {
    pub(crate) fn from_bytes(version: u64, bytes: &[u8]) -> Self {
        Self {
            version,
            file: FileInfo::from_bytes(bytes),
        }
    }

    fn wire(&self) -> Value {
        let mut value = self.file.wire();
        value["version"] = self.version.into();
        value
    }
}

fn target_limit(path: &str) -> Result<usize> {
    if path == "catalog.json" {
        return Ok(CATALOG_LIMIT);
    }
    if let Some((hash, "png" | "webp")) =
        path.strip_prefix("assets/").and_then(|p| p.split_once('.'))
        && is_lower_hex(hash, 64)
    {
        return Ok(ICON_LIMIT);
    }
    Err(CatalogError::new("Unexpected catalog target path"))
}

#[derive(Debug)]
pub(crate) struct Online {
    pub(crate) version: u64,
    pub(crate) expires: OffsetDateTime,
    pub(crate) signed: Value,
    role: Role,
}

impl Online {
    pub(crate) fn verify(
        bytes: &[u8],
        role: Role,
        root: &Root,
        now: OffsetDateTime,
        allow_expired: bool,
    ) -> Result<Self> {
        if role == Role::Root {
            return Err(CatalogError::new("Expected an online TUF role"));
        }
        let env = Envelope::parse(bytes, role)?;
        if !allow_expired && env.expires <= now {
            return Err(CatalogError::new(format!(
                "Invalid or expired {}",
                role.as_str()
            )));
        }
        root.verify(role, &canonical(&env.signed)?, &env.signatures)?;
        Ok(Self {
            version: env.version,
            expires: env.expires,
            signed: env.signed,
            role,
        })
    }

    pub(crate) fn link(&self) -> Result<MetaLink> {
        let (name, child_role) = self.role.child()?;
        let links = fields(&self.signed["meta"], &[name])?;
        let link = &links[name];
        fields(link, &["length", "hashes", "version"])?;
        Ok(MetaLink {
            version: version(&link["version"])?,
            file: FileInfo::parse(link, child_role.limit())?,
        })
    }

    pub(crate) fn targets(&self) -> Result<BTreeMap<String, FileInfo>> {
        let listed = self.signed["targets"]
            .as_object()
            .ok_or_else(|| CatalogError::new("Invalid signed targets"))?;
        listed
            .iter()
            .map(|(path, file)| {
                fields(file, &["length", "hashes"])?;
                Ok((path.clone(), FileInfo::parse(file, target_limit(path)?)?))
            })
            .collect()
    }
}

pub(crate) fn sign_targets(
    root: &Root,
    keys: &SigningKeys,
    version: u64,
    expires: OffsetDateTime,
    targets: &BTreeMap<String, FileInfo>,
) -> Result<Vec<u8>> {
    let mut listed = Map::new();
    for (path, file) in targets {
        file.validate(target_limit(path)?)?;
        listed.insert(path.clone(), file.wire());
    }
    sign(
        Role::Targets,
        root,
        keys,
        version,
        expires,
        json!({"targets": listed}),
    )
}

pub(crate) fn sign_link(
    role: Role,
    root: &Root,
    keys: &SigningKeys,
    version: u64,
    expires: OffsetDateTime,
    link: &MetaLink,
) -> Result<Vec<u8>> {
    let (name, child) = role.child()?;
    link.file.validate(child.limit())?;
    if !(1..=MAX_SAFE_VERSION).contains(&link.version) {
        return Err(CatalogError::new("Invalid linked metadata version"));
    }
    sign(
        role,
        root,
        keys,
        version,
        expires,
        json!({"meta": {(name): link.wire()}}),
    )
}

fn sign(
    role: Role,
    root: &Root,
    keys: &SigningKeys,
    version: u64,
    expires: OffsetDateTime,
    mut signed: Value,
) -> Result<Vec<u8>> {
    if !(1..=MAX_SAFE_VERSION).contains(&version) {
        return Err(CatalogError::new("Invalid metadata version"));
    }
    signed["_type"] = role.as_str().into();
    signed["version"] = version.into();
    signed["spec_version"] = "1.0.0".into();
    signed["expires"] = expires_string(expires)?.into();
    let signature = keys.sign(root, role, &canonical(&signed)?)?;
    let bytes = serde_json::to_vec(&json!({"signed": signed, "signatures": [signature]}))
        .map_err(|_| CatalogError::new("Cannot encode TUF envelope"))?;
    if bytes.len() > role.limit() {
        return Err(CatalogError::new("Oversized signed metadata"));
    }
    Ok(bytes)
}
