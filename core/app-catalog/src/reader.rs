use std::sync::Arc;

use time::OffsetDateTime;

use crate::metadata::{CATALOG_LIMIT, FileInfo, KeyHistory, MetaLink, Online, Role, Root};
use crate::{
    CATALOG_TARGET, CatalogDocument, CatalogError, Result, TIMESTAMP_PATH, next_version,
    replacement_root, target_path, version_path,
};

const MAX_ROOT_ROTATIONS: usize = 1024;

pub struct ReadOptions<'a> {
    pub now: OffsetDateTime,
    pub allow_expired_roles: bool,
    pub next_root: Option<&'a [u8]>,
    pub previous: Option<&'a TrustedCatalog>,
}

/// Verified repository state, kept as a high-water checkpoint across reads.
pub struct TrustedCatalog {
    pub(crate) catalog_bytes: Vec<u8>,
    pub(crate) catalog: Arc<CatalogDocument>,
    pub(crate) root_bytes: Vec<u8>,
    pub(crate) root: Root,
    pub(crate) history: KeyHistory,
    pub(crate) timestamp: Online,
    pub(crate) snapshot: Online,
    pub(crate) targets: Online,
    pub(crate) snapshot_link: MetaLink,
    pub(crate) targets_link: MetaLink,
}

impl TrustedCatalog {
    pub fn catalog_bytes(&self) -> &[u8] {
        &self.catalog_bytes
    }
}

/// The authenticated catalog and its signed target references for package selection.
pub struct TrustedPackageCatalog(TrustedCatalog);

impl TrustedPackageCatalog {
    pub fn catalog_bytes(&self) -> &[u8] {
        self.0.catalog_bytes()
    }
}

enum IconTargets {
    VerifyContents,
    VerifyReferences,
}

/// Verify a package reader's catalog checkpoint and authenticate the signed icon references.
pub fn read_package_catalog(
    read: impl FnMut(&str, usize) -> Result<Option<Vec<u8>>>,
    pinned_root: &[u8],
    now: OffsetDateTime,
    previous: Option<&TrustedPackageCatalog>,
) -> Result<TrustedPackageCatalog> {
    let options = ReadOptions {
        now,
        allow_expired_roles: false,
        next_root: None,
        previous: previous.map(|catalog| &catalog.0),
    };
    read_repository(read, pinned_root, options, IconTargets::VerifyReferences)
        .map(TrustedPackageCatalog)
}

/// Read files under the TUF repository root with a byte limit per request.
/// The callback returns `None` for an absent file.
pub fn read_catalog(
    read: impl FnMut(&str, usize) -> Result<Option<Vec<u8>>>,
    pinned_root: &[u8],
    options: ReadOptions<'_>,
) -> Result<TrustedCatalog> {
    read_repository(read, pinned_root, options, IconTargets::VerifyContents)
}

fn read_repository(
    mut read: impl FnMut(&str, usize) -> Result<Option<Vec<u8>>>,
    pinned_root: &[u8],
    options: ReadOptions<'_>,
    icons: IconTargets,
) -> Result<TrustedCatalog> {
    let (root, root_bytes, history) = read_root_chain(&mut read, pinned_root, &options)?;
    let timestamp_bytes = require_bytes(&mut read, TIMESTAMP_PATH, Role::Timestamp.limit())?;
    let timestamp = Online::verify(
        &timestamp_bytes,
        Role::Timestamp,
        &root,
        options.now,
        options.allow_expired_roles,
    )?;
    check_high_water(
        Role::Timestamp,
        &timestamp,
        options.previous.map(|state| &state.timestamp),
    )?;
    let snapshot_link = timestamp.link()?;
    let snapshot = read_linked_role(&mut read, Role::Snapshot, &snapshot_link, &root, &options)?;
    check_high_water(
        Role::Snapshot,
        &snapshot,
        options.previous.map(|state| &state.snapshot),
    )?;
    let targets_link = snapshot.link()?;
    let targets = read_linked_role(&mut read, Role::Targets, &targets_link, &root, &options)?;
    check_high_water(
        Role::Targets,
        &targets,
        options.previous.map(|state| &state.targets),
    )?;

    let listed = targets.targets()?;
    let catalog_file = listed
        .get(CATALOG_TARGET)
        .ok_or_else(|| CatalogError::new("Missing catalog target"))?;
    let catalog_bytes = read_target(&mut read, CATALOG_TARGET, catalog_file, CATALOG_LIMIT)?;
    let catalog = if let Some(previous) = options
        .previous
        .filter(|state| catalog_bytes == state.catalog_bytes)
    {
        // The checkpoint has already validated this exact catalog against the contract.
        Arc::clone(&previous.catalog)
    } else {
        let catalog = CatalogDocument::parse(&catalog_bytes)?;
        if options
            .previous
            .is_some_and(|state| catalog.revision <= state.catalog.revision)
        {
            return Err(CatalogError::new("Catalog rollback or revision reuse"));
        }
        Arc::new(catalog)
    };
    if listed.len() != catalog.icons.len() + 1 {
        return Err(CatalogError::new("Unexpected catalog targets"));
    }
    for (name, icon) in &catalog.icons {
        if listed.get(name) != Some(icon) {
            return Err(CatalogError::new("Signed icon identity differs"));
        }
        if matches!(icons, IconTargets::VerifyContents) {
            // Validate each target separately so the reader retains no icon bytes.
            read_target(&mut read, name, icon, icon.length)?;
        }
    }

    Ok(TrustedCatalog {
        catalog,
        catalog_bytes,
        root,
        root_bytes,
        history,
        timestamp,
        snapshot,
        targets,
        snapshot_link,
        targets_link,
    })
}

fn read_root_chain(
    read: &mut impl FnMut(&str, usize) -> Result<Option<Vec<u8>>>,
    pinned_root: &[u8],
    options: &ReadOptions<'_>,
) -> Result<(Root, Vec<u8>, KeyHistory)> {
    let mut root = Root::parse(pinned_root, None)?;
    let root_limit = Role::Root.limit();
    let mut root_bytes = require_bytes(read, &version_path(Role::Root, root.version), root_limit)?;
    if root_bytes != pinned_root {
        return Err(CatalogError::new(
            "Repository root differs from pinned root",
        ));
    }
    // A newer pin can omit older roots that were authenticated by the checkpoint.
    let mut history = options
        .previous
        .map(|state| state.history.clone())
        .unwrap_or_default();
    history.record(&root)?;
    for count in 0..=MAX_ROOT_ROTATIONS {
        if options.previous.is_some_and(|state| {
            state.root.version == root.version && state.root_bytes != root_bytes
        }) {
            return Err(CatalogError::new(
                "Root history differs from trusted checkpoint",
            ));
        }
        let path = version_path(Role::Root, next_version(root.version)?);
        let Some(bytes) = read(&path, root_limit)? else {
            break;
        };
        if count == MAX_ROOT_ROTATIONS {
            return Err(CatalogError::new("Root rotation limit exceeded"));
        }
        root = Root::parse(&bytes, Some(&root))?;
        history.record(&root)?;
        root_bytes = bytes;
    }
    if options
        .previous
        .is_some_and(|state| root.version < state.root.version)
    {
        return Err(CatalogError::new(
            "Metadata rollback or version reuse: root",
        ));
    }
    if root.expires <= options.now {
        let next_root = options
            .next_root
            .filter(|_| options.allow_expired_roles)
            .ok_or_else(|| CatalogError::new("Expired root"))?;
        // The pending root authorizes recovery only. The installed root still
        // authenticates every repository file read below.
        replacement_root(next_root, &root, &history, options.now)?;
    }
    Ok((root, root_bytes, history))
}

fn read_linked_role(
    read: &mut impl FnMut(&str, usize) -> Result<Option<Vec<u8>>>,
    role: Role,
    link: &MetaLink,
    root: &Root,
    options: &ReadOptions<'_>,
) -> Result<Online> {
    link.file.validate(role.limit())?;
    let bytes = require_bytes(read, &version_path(role, link.version), link.file.length)?;
    link.file.verify(&bytes, role.limit())?;
    let metadata = Online::verify(&bytes, role, root, options.now, options.allow_expired_roles)?;
    if metadata.version != link.version {
        return Err(CatalogError::new(format!(
            "Invalid signed {}",
            role.as_str()
        )));
    }
    Ok(metadata)
}

fn check_high_water(role: Role, current: &Online, known: Option<&Online>) -> Result<()> {
    if known.is_some_and(|known| {
        current.version < known.version
            || (current.version == known.version && current.signed != known.signed)
    }) {
        return Err(CatalogError::new(format!(
            "Metadata rollback or version reuse: {}",
            role.as_str()
        )));
    }
    Ok(())
}

fn read_target(
    read: &mut impl FnMut(&str, usize) -> Result<Option<Vec<u8>>>,
    name: &str,
    file: &FileInfo,
    limit: usize,
) -> Result<Vec<u8>> {
    file.validate(limit)?;
    let path = target_path(name, file);
    let bytes = require_bytes(read, &path, file.length)?;
    file.verify(&bytes, limit)
        .map_err(|_| CatalogError::new("Target bytes differ"))?;
    Ok(bytes)
}

fn require_bytes(
    read: &mut impl FnMut(&str, usize) -> Result<Option<Vec<u8>>>,
    path: &str,
    limit: usize,
) -> Result<Vec<u8>> {
    read(path, limit)?
        .filter(|bytes| !bytes.is_empty() && bytes.len() <= limit)
        .ok_or_else(|| CatalogError::new(format!("Missing or oversized catalog file: {path}")))
}
