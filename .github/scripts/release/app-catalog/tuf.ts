import { isDeepStrictEqual } from 'node:util'
import {
    MetaFile,
    Snapshot,
    TargetFile,
    Targets,
    Timestamp,
} from '@tufjs/models'
import { parseCatalog, type Catalog } from '../../../../contracts/v1/index.ts'
import {
    decode,
    digest,
    limits,
    linkFor,
    parseRoot,
    positiveVersion,
    signedBytes,
    targetFor,
    targetPath,
    verifyReplacementRoot,
    versionPath,
    type RootMetadata,
    type SigningKeys,
} from './tuf-metadata.ts'
import { catalogIcons, type TrustedCatalog } from './tuf-reader.ts'

export { readTrustedCatalog, type TrustedCatalog } from './tuf-reader.ts'
export type { SigningKeys } from './tuf-metadata.ts'

const day = 86_400_000
const lifetime = { targets: 90 * day, snapshot: 7 * day, timestamp: day }
const renewalWindow = {
    targets: 14 * day,
    snapshot: 2 * day,
    timestamp: day / 2,
}
type Role = keyof typeof lifetime
type Changes = Map<string, Buffer>

function roleFields(role: Role, now: Date, state?: TrustedCatalog) {
    return {
        version: positiveVersion(
            (state?.metadata[role].signed.version ?? 0) + 1,
        ),
        expires: new Date(now.getTime() + lifetime[role])
            .toISOString()
            .replace(/\.\d{3}Z$/u, 'Z'),
        specVersion: '1.0.0',
    }
}

function due(role: Role, now: Date, state?: TrustedCatalog) {
    return (
        !state ||
        state.metadata[role].signed.isExpired(
            new Date(now.getTime() + renewalWindow[role]),
        )
    )
}

function releaseKey(entry: { appId: string; version: string }) {
    return entry.appId + '@' + entry.version
}

function validateTransition(current: Catalog, next: Catalog) {
    const releases = new Map(
        next.releases.map((release) => [releaseKey(release), release]),
    )
    const revocations = new Map(
        next.revocations.map((entry) => [releaseKey(entry), entry]),
    )
    for (const entry of current.revocations) {
        if (!isDeepStrictEqual(entry, revocations.get(releaseKey(entry))))
            throw new Error('Existing revocation changed')
    }
    for (const entry of current.releases) {
        if (
            !revocations.has(releaseKey(entry)) &&
            !isDeepStrictEqual(entry, releases.get(releaseKey(entry)))
        ) {
            throw new Error('Existing release changed without a revocation')
        }
    }
}

function prepareTargets(
    catalog: Catalog,
    bytes: Buffer,
    files: Changes,
    state?: TrustedCatalog,
    suppliedIcons: ReadonlyMap<string, Buffer> = new Map(),
) {
    const catalogTarget = targetFor('catalog.json', bytes)
    const targets: Record<string, TargetFile> = {
        'catalog.json': catalogTarget,
    }
    if (!state?.catalogBytes.equals(bytes))
        files.set(targetPath(catalogTarget), bytes)
    const icons = catalogIcons(catalog)
    for (const path of suppliedIcons.keys()) {
        if (!icons.has(path)) throw new Error('Unexpected supplied icon')
    }
    for (const [path, icon] of icons) {
        const target = new TargetFile({
            path,
            length: icon.sizeBytes,
            hashes: { sha256: icon.sha256 },
        })
        const previous = state?.metadata.targets.signed.targets[path]
        const supplied = suppliedIcons.get(path)
        if (
            supplied &&
            (supplied.length !== target.length ||
                digest(supplied) !== target.hashes.sha256)
        ) {
            throw new Error('Supplied icon bytes do not match catalog')
        }
        if (!previous?.equals(target)) {
            if (!supplied) throw new Error('Missing approved icon bytes')
            files.set(targetPath(target), supplied)
        }
        targets[path] = target
    }
    return targets
}

function buildUpdate(
    root: RootMetadata,
    next: Catalog,
    keys: SigningKeys,
    now: Date,
    files: Changes,
    state?: TrustedCatalog,
    icons?: ReadonlyMap<string, Buffer>,
) {
    if (!Number.isFinite(now.getTime()) || root.signed.isExpired(now))
        throw new Error('Expired root')
    const catalog = parseCatalog(next)
    const previous = state && parseCatalog(decode(state.catalogBytes))
    const changed = !previous || !isDeepStrictEqual(previous, catalog)
    if (previous && changed) {
        if (previous.revision + 1 !== catalog.revision)
            throw new Error('Catalog revision must increase by one')
        validateTransition(previous, catalog)
    }
    const rotated = state?.metadata.root.signed.version !== root.signed.version
    let targetsLink: MetaFile | undefined =
        state?.metadata.snapshot.signed.meta['targets.json']
    const signTargets = changed || rotated || due('targets', now, state)
    if (signTargets || icons?.size) {
        const catalogBytes =
            !changed && state
                ? state.catalogBytes
                : Buffer.from(JSON.stringify(catalog))
        if (catalogBytes.length > limits.catalog)
            throw new Error('Oversized catalog')
        const entries = prepareTargets(
            catalog,
            catalogBytes,
            files,
            state,
            icons,
        )
        if (signTargets) {
            const targets = new Targets({
                ...roleFields('targets', now, state),
                targets: entries,
            })
            const bytes = signedBytes(targets, root, keys)
            files.set(versionPath('targets', targets.version), bytes)
            targetsLink = linkFor(targets.version, bytes)
        }
    }

    const signSnapshot = signTargets || due('snapshot', now, state)
    let snapshotLink: MetaFile | undefined =
        state?.metadata.timestamp.signed.snapshotMeta
    if (signSnapshot) {
        if (!targetsLink) throw new Error('Missing targets metadata')
        const snapshot = new Snapshot({
            ...roleFields('snapshot', now, state),
            meta: { 'targets.json': targetsLink },
        })
        const bytes = signedBytes(snapshot, root, keys)
        files.set(versionPath('snapshot', snapshot.version), bytes)
        snapshotLink = linkFor(snapshot.version, bytes)
    }
    if (signSnapshot || due('timestamp', now, state)) {
        if (!snapshotLink) throw new Error('Missing snapshot metadata')
        const timestamp = new Timestamp({
            ...roleFields('timestamp', now, state),
            snapshotMeta: snapshotLink,
        })
        files.set('metadata/timestamp.json', signedBytes(timestamp, root, keys))
    }
    return files
}

export async function catalogUpdate(
    state: TrustedCatalog,
    next: Catalog,
    keys: SigningKeys,
    options: {
        now?: Date
        icons?: ReadonlyMap<string, Buffer>
        nextRoot?: Buffer
    } = {},
): Promise<ReadonlyMap<string, Buffer>> {
    const now = options.now ?? new Date()
    const files: Changes = new Map()
    let root = state.metadata.root
    if (options.nextRoot && !state.rootBytes.equals(options.nextRoot)) {
        root = verifyReplacementRoot(
            options.nextRoot,
            root,
            state.keyHistory,
            now,
        )
        files.set(versionPath('root', root.signed.version), options.nextRoot)
    }
    return buildUpdate(root, next, keys, now, files, state, options.icons)
}

export async function catalogBootstrap(
    pinnedRoot: Buffer,
    keys: SigningKeys,
    now = new Date(),
): Promise<ReadonlyMap<string, Buffer>> {
    const root = parseRoot(pinnedRoot, now)
    if (root.signed.version !== 1)
        throw new Error('Bootstrap requires root version 1')
    const files = new Map([[versionPath('root', 1), pinnedRoot]])
    return buildUpdate(
        root,
        { formatVersion: 1, revision: 1, releases: [], revocations: [] },
        keys,
        now,
        files,
    )
}
