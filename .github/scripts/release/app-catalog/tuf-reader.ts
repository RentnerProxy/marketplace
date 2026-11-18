import { isDeepStrictEqual } from 'node:util'
import {
    Metadata,
    MetadataKind,
    type Root,
    type Snapshot,
    type TargetFile,
    type Targets,
    type Timestamp,
} from '@tufjs/models'
import {
    catalogIconTarget,
    parseCatalog,
    type Catalog,
} from '../../../../contracts/v1/index.ts'
import {
    checkKeyHistory,
    checkMetadata,
    decode,
    digest,
    limits,
    parseRoot,
    requireBytes,
    requireLink,
    targetPath,
    versionPath,
    type CatalogRead,
    type KeyHistory,
} from './tuf-metadata.ts'

export function catalogIcons(catalog: Catalog) {
    const icons = new Map<string, ReturnType<typeof catalogIconTarget>>()
    for (const { icon } of catalog.releases) {
        if (!icon) continue
        const target = catalogIconTarget(icon)
        const previous = icons.get(target.path)
        if (previous && previous.sizeBytes !== target.sizeBytes)
            throw new Error('Conflicting icon length')
        icons.set(target.path, target)
    }
    return icons
}

async function readTarget(
    read: CatalogRead,
    target: TargetFile,
    limit: number,
) {
    const length = requireLink(target, limit)
    const bytes = await requireBytes(read, targetPath(target), length)
    if (bytes.length !== length || digest(bytes) !== target.hashes.sha256)
        throw new Error('Target bytes differ')
    return bytes
}

export async function readTrustedCatalog(
    read: CatalogRead,
    pinnedRoot: Buffer,
    options: {
        now?: Date
        allowExpiredRoles?: boolean
        previous?: TrustedCatalog
    } = {},
): Promise<TrustedCatalog> {
    const now = options.now ?? new Date()
    let rootBytes = pinnedRoot
    let root = parseRoot(rootBytes, now)
    const first = await requireBytes(
        read,
        versionPath('root', root.signed.version),
        limits.root,
    )
    if (!first.equals(pinnedRoot))
        throw new Error('Repository root differs from pinned root')
    const keyHistory: KeyHistory = {
        rolesByPublicKey: new Map(),
        publicKeysById: new Map(),
    }
    checkKeyHistory(root, keyHistory)
    for (let count = 0; ; count++) {
        if (
            options.previous?.metadata.root.signed.version ===
                root.signed.version &&
            !rootBytes.equals(options.previous.rootBytes)
        ) {
            throw new Error('Root history differs from trusted checkpoint')
        }
        // Each root must be authenticated by the immediately preceding root.
        // oxlint-disable-next-line no-await-in-loop
        const next = await read(
            versionPath('root', root.signed.version + 1),
            limits.root,
        )
        if (next === null) break
        if (count >= 1024) throw new Error('Root rotation limit exceeded')
        rootBytes = Buffer.from(next.buffer, next.byteOffset, next.byteLength)
        root = parseRoot(rootBytes, now, root)
        checkKeyHistory(root, keyHistory)
    }
    if (root.signed.isExpired(now)) throw new Error('Expired root')

    const timestampBytes = await requireBytes(
        read,
        'metadata/timestamp.json',
        limits.timestamp,
    )
    const timestamp = checkMetadata(
        Metadata.fromJSON(MetadataKind.Timestamp, decode(timestampBytes)),
        timestampBytes,
        now,
        options.allowExpiredRoles,
    )
    root.verifyDelegate('timestamp', timestamp)

    const snapshotLink = timestamp.signed.snapshotMeta
    const snapshotBytes = await requireBytes(
        read,
        versionPath('snapshot', snapshotLink.version),
        requireLink(snapshotLink, limits.snapshot),
    )
    snapshotLink.verify(snapshotBytes)
    const snapshot = checkMetadata(
        Metadata.fromJSON(MetadataKind.Snapshot, decode(snapshotBytes)),
        snapshotBytes,
        now,
        options.allowExpiredRoles,
    )
    root.verifyDelegate('snapshot', snapshot)
    if (
        snapshot.signed.version !== snapshotLink.version ||
        Object.keys(snapshot.signed.meta).length !== 1
    ) {
        throw new Error('Invalid signed snapshot')
    }

    const targetsLink = snapshot.signed.meta['targets.json']
    const targetsLength = requireLink(targetsLink, limits.targets)
    const targetsBytes = await requireBytes(
        read,
        versionPath('targets', targetsLink.version),
        targetsLength,
    )
    targetsLink.verify(targetsBytes)
    const targets = checkMetadata(
        Metadata.fromJSON(MetadataKind.Targets, decode(targetsBytes)),
        targetsBytes,
        now,
        options.allowExpiredRoles,
    )
    root.verifyDelegate('targets', targets)
    if (
        targets.signed.version !== targetsLink.version ||
        targets.signed.delegations
    )
        throw new Error('Invalid signed targets')

    const listed = targets.signed.targets
    const catalogBytes = await readTarget(
        read,
        listed['catalog.json'],
        limits.catalog,
    )
    const catalog = parseCatalog(decode(catalogBytes))
    const icons = catalogIcons(catalog)
    if (Object.keys(listed).length !== icons.size + 1)
        throw new Error('Unexpected catalog targets')
    for (const icon of icons.values()) {
        const target = listed[icon.path]
        if (
            !target ||
            target.length !== icon.sizeBytes ||
            target.hashes.sha256 !== icon.sha256
        )
            throw new Error('Signed icon identity differs')
        // Bound memory and concurrent repository requests for catalogs with many icons.
        // oxlint-disable-next-line no-await-in-loop
        await readTarget(read, target, icon.sizeBytes)
    }
    const metadata = { root, timestamp, snapshot, targets }
    if (options.previous) {
        for (const role of Object.values(MetadataKind)) {
            const current = metadata[role].signed
            const known = options.previous.metadata[role].signed
            if (
                current.version < known.version ||
                (current.version === known.version &&
                    !isDeepStrictEqual(current.toJSON(), known.toJSON()))
            ) {
                throw new Error('Metadata rollback or version reuse: ' + role)
            }
        }
        if (
            catalog.revision < options.previous.catalog.revision ||
            (catalog.revision === options.previous.catalog.revision &&
                !catalogBytes.equals(options.previous.catalogBytes))
        ) {
            throw new Error('Catalog rollback or revision reuse')
        }
    }
    return { catalog, catalogBytes, metadata, rootBytes, keyHistory }
}

export interface TrustedCatalog {
    catalog: Catalog
    catalogBytes: Buffer
    rootBytes: Buffer
    keyHistory: KeyHistory
    metadata: {
        root: Metadata<Root>
        timestamp: Metadata<Timestamp>
        snapshot: Metadata<Snapshot>
        targets: Metadata<Targets>
    }
}
