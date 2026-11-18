mod metadata;
mod reader;
mod update;

use std::collections::{BTreeMap, btree_map::Entry};
use std::error::Error;
use std::fmt;
use std::sync::OnceLock;

use rentnerproxy_app_contracts::Contracts;
use serde_json::Value;
use time::OffsetDateTime;

pub use metadata::SigningKeys;
pub use reader::{ReadOptions, TrustedCatalog, read_catalog};
pub use update::{UpdateOptions, bootstrap_catalog, update_catalog};

use metadata::{CATALOG_LIMIT, FileInfo, KeyHistory, MAX_SAFE_VERSION, Role, Root, decode};

const TIMESTAMP_PATH: &str = "metadata/timestamp.json";
const CATALOG_TARGET: &str = "catalog.json";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CatalogError(String);

impl CatalogError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for CatalogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for CatalogError {}

pub type Result<T> = std::result::Result<T, CatalogError>;

fn next_version(version: u64) -> Result<u64> {
    if version >= MAX_SAFE_VERSION {
        return Err(CatalogError::new("Invalid metadata version"));
    }
    Ok(version + 1)
}

fn version_path(role: Role, version: u64) -> String {
    format!("metadata/{version}.{}.json", role.as_str())
}

fn target_path(name: &str, file: &FileInfo) -> String {
    // `name` is either the fixed catalog target or derived from a validated icon.
    let hash = &file.sha256;
    match name.rsplit_once('/') {
        Some((directory, file)) => format!("targets/{directory}/{hash}.{file}"),
        None => format!("targets/{hash}.{name}"),
    }
}

fn replacement_root(
    bytes: &[u8],
    installed: &Root,
    history: &KeyHistory,
    now: OffsetDateTime,
) -> Result<Root> {
    let next = Root::parse(bytes, Some(installed))?;
    if next.expires <= now {
        return Err(CatalogError::new("Expired replacement root"));
    }
    history.validate(&next)?;
    Ok(next)
}

struct CatalogDocument {
    value: Value,
    revision: u64,
    icons: BTreeMap<String, FileInfo>,
}

impl CatalogDocument {
    fn parse(bytes: &[u8]) -> Result<Self> {
        static CONTRACTS: OnceLock<
            std::result::Result<Contracts, rentnerproxy_app_contracts::ContractError>,
        > = OnceLock::new();

        if bytes.len() > CATALOG_LIMIT {
            return Err(CatalogError::new("Oversized catalog"));
        }
        let value = decode(bytes)?;
        let contracts = CONTRACTS
            .get_or_init(Contracts::new)
            .as_ref()
            .map_err(|_| CatalogError::new("Catalog contract is unavailable"))?;
        let catalog = contracts
            .validate_catalog(&value)
            .map_err(|error| CatalogError::new(format!("Invalid catalog: {}", error.code())))?;

        let mut icons = BTreeMap::new();
        for icon in catalog
            .releases()
            .iter()
            .filter_map(|release| release.get("icon"))
        {
            let sha256 = icon["sha256"].as_str().expect("validated icon hash");
            let format = icon["format"].as_str().expect("validated icon format");
            let length = icon["sizeBytes"].as_f64().expect("validated icon size") as usize;
            let name = format!("assets/{sha256}.{format}");
            let file = FileInfo {
                length,
                sha256: sha256.into(),
            };
            match icons.entry(name) {
                Entry::Vacant(entry) => {
                    entry.insert(file);
                }
                Entry::Occupied(entry) if entry.get() != &file => {
                    return Err(CatalogError::new("Conflicting icon length"));
                }
                _ => {}
            }
        }
        let revision = value["revision"].as_f64().expect("validated revision") as u64;
        Ok(Self {
            value,
            revision,
            icons,
        })
    }

    fn releases(&self) -> &[Value] {
        self.value["releases"]
            .as_array()
            .expect("validated releases")
    }

    fn revocations(&self) -> &[Value] {
        self.value["revocations"]
            .as_array()
            .expect("validated revocations")
    }
}
