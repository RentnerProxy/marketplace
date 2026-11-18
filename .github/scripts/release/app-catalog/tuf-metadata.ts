import { Buffer } from 'node:buffer'
import {
    createHash,
    createPrivateKey,
    createPublicKey,
    sign,
} from 'node:crypto'
import { posix } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
    Metadata,
    MetadataKind,
    MetaFile,
    Signature,
    TargetFile,
    type Root,
    type Snapshot,
    type Targets,
    type Timestamp,
} from '@tufjs/models'
import { isWireJson } from '../../../../contracts/v1/wire.ts'

export type OnlineRole = 'targets' | 'snapshot' | 'timestamp'
export type SigningKeys = Record<OnlineRole, string>
export type CatalogRead = (
    path: string,
    maxBytes: number,
) => Promise<Uint8Array | null>
export type RootMetadata = Metadata<Root>
export interface KeyHistory {
    rolesByPublicKey: Map<string, string>
    publicKeysById: Map<string, string>
}
type SignedRole = Root | Targets | Snapshot | Timestamp

export const limits = {
    root: 512 * 1024,
    targets: 4 * 1024 * 1024,
    snapshot: 128 * 1024,
    timestamp: 32 * 1024,
    catalog: 16 * 1024 * 1024,
}
const sha256Pattern = /^[0-9a-f]{64}$/u

export function positiveVersion(value: number) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error('Invalid metadata version')
    return value
}

export function digest(bytes: Buffer) {
    return createHash('sha256').update(bytes).digest('hex')
}

export function versionPath(
    role: 'root' | 'targets' | 'snapshot',
    version: number,
) {
    return 'metadata/' + positiveVersion(version) + '.' + role + '.json'
}

export function targetPath(target: TargetFile) {
    return posix.join(
        'targets',
        posix.dirname(target.path),
        target.hashes.sha256 + '.' + posix.basename(target.path),
    )
}

export function targetFor(path: string, bytes: Buffer) {
    return new TargetFile({
        path,
        length: bytes.length,
        hashes: { sha256: digest(bytes) },
    })
}

export function linkFor(version: number, bytes: Buffer) {
    return new MetaFile({
        version,
        length: bytes.length,
        hashes: { sha256: digest(bytes) },
    })
}

export async function requireBytes(
    read: CatalogRead,
    path: string,
    max: number,
) {
    const bytes = await read(path, max)
    if (!bytes || bytes.length === 0 || bytes.length > max)
        throw new Error('Missing or oversized catalog file: ' + path)
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function requireLink(link: MetaFile | TargetFile, max: number) {
    if (
        !link ||
        !link.hashes ||
        Object.keys(link.hashes).length !== 1 ||
        !sha256Pattern.test(link.hashes.sha256) ||
        !link.length ||
        !Number.isSafeInteger(link.length) ||
        link.length > max ||
        link.length < 1
    ) {
        throw new Error('Invalid signed metadata length or SHA-256')
    }
    return link.length
}

function isJsonObject(
    value: unknown,
): value is ReturnType<RootMetadata['toJSON']> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        isWireJson(value)
    )
}

export function decode(bytes: Buffer) {
    const object: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    )
    if (!isJsonObject(object)) throw new Error('Invalid catalog JSON object')
    return object
}

export function checkMetadata<T extends SignedRole>(
    metadata: Metadata<T>,
    bytes: Buffer,
    now: Date,
    allowExpired = false,
) {
    const { signed } = metadata
    positiveVersion(signed.version)
    if (!isDeepStrictEqual(decode(bytes).signed, signed.toJSON())) {
        throw new Error('Metadata has ambiguous signed fields')
    }
    if (
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(signed.expires) ||
        !Number.isFinite(Date.parse(signed.expires)) ||
        new Date(signed.expires).toISOString() !==
            signed.expires.replace('Z', '.000Z') ||
        !Number.isFinite(now.getTime()) ||
        (!allowExpired && signed.isExpired(now))
    )
        throw new Error('Invalid or expired ' + signed.type)
    return metadata
}

export function parseRoot(bytes: Buffer, now: Date, previous?: RootMetadata) {
    if (bytes.length > limits.root) throw new Error('Oversized root')
    const root = checkMetadata(
        Metadata.fromJSON(MetadataKind.Root, decode(bytes)),
        bytes,
        now,
        true,
    )
    if (!root.signed.consistentSnapshot)
        throw new Error('Consistent snapshots required')
    const publicKeys = new Set<string>()
    const roles = Object.values(MetadataKind)
    if (Object.keys(root.signed.roles).length !== roles.length)
        throw new Error('Unexpected root role')
    for (const name of roles) {
        const role = root.signed.roles[name]
        if (
            !Number.isSafeInteger(role.threshold) ||
            role.threshold < 1 ||
            role.threshold > role.keyIDs.length
        ) {
            throw new Error('Invalid role threshold')
        }
        for (const id of role.keyIDs) {
            const key = root.signed.keys[id]
            if (
                !sha256Pattern.test(id) ||
                !key ||
                key.keyType !== 'ed25519' ||
                key.scheme !== 'ed25519' ||
                !sha256Pattern.test(key.keyVal.public) ||
                Object.keys(key.keyVal).length !== 1 ||
                publicKeys.has(key.keyVal.public)
            )
                throw new Error('Invalid or reused Ed25519 role key')
            publicKeys.add(key.keyVal.public)
        }
    }
    if (Object.keys(root.signed.keys).length !== publicKeys.size)
        throw new Error('Unexpected root key')
    root.verifyDelegate('root', root)
    if (previous) {
        if (root.signed.version !== previous.signed.version + 1)
            throw new Error('Nonsequential root rotation')
        previous.verifyDelegate('root', root)
    }
    return root
}

export function checkKeyHistory(root: RootMetadata, history: KeyHistory) {
    for (const [name, role] of Object.entries(root.signed.roles)) {
        for (const id of role.keyIDs) {
            const publicKey = root.signed.keys[id].keyVal.public
            const previous = history.rolesByPublicKey.get(publicKey)
            if (previous && previous !== name)
                throw new Error('Root rotation reassigns a key across roles')
            const previousKey = history.publicKeysById.get(id)
            if (previousKey && previousKey !== publicKey)
                throw new Error('Root rotation reuses a key ID')
            history.rolesByPublicKey.set(publicKey, name)
            history.publicKeysById.set(id, publicKey)
        }
    }
}

export function signedBytes(
    role: Targets | Timestamp | Snapshot,
    root: RootMetadata,
    keys: SigningKeys,
) {
    const key = createPrivateKey(keys[role.type])
    const jwk = createPublicKey(key).export({ format: 'jwk' })
    if (jwk.crv !== 'Ed25519' || !jwk.x)
        throw new Error('Expected an Ed25519 signing key')
    const raw = Buffer.from(jwk.x, 'base64url').toString('hex')
    const id = root.signed.roles[role.type].keyIDs.find(
        (keyID) => root.signed.keys[keyID].keyVal.public === raw,
    )
    if (!id) throw new Error('Signing key is not authorized for ' + role.type)
    const metadata = new Metadata(role)
    metadata.sign(
        (bytes) =>
            new Signature({
                keyID: id,
                sig: sign(null, bytes, key).toString('hex'),
            }),
    )
    root.verifyDelegate(role.type, metadata)
    const bytes = Buffer.from(JSON.stringify(metadata.toJSON()))
    if (bytes.length > limits[role.type])
        throw new Error('Oversized signed metadata')
    return bytes
}
