/* eslint-disable no-await-in-loop -- Each descriptor is resolved and secured against its pinned predecessor. */
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import {
    chmod,
    lstat,
    mkdir,
    open,
    rename,
    statfs,
    unlink,
} from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { CoreCommandError } from '@/server/Core/error.ts'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import type { PrivateStorageFileWriteInput } from './Types/private-files.types.ts'

const FAILURE = 'Private storage operation failed.'
// Linux x64 and arm64 share O_PATH; Bun does not export this Linux constant.
const DIRECTORY_FLAGS = 2097152 | constants.O_DIRECTORY | constants.O_NOFOLLOW
const SAFE_CODES = new Set([
    'ENOENT',
    'EACCES',
    'EPERM',
    'ENOTDIR',
    'EISDIR',
    'ELOOP',
    'EEXIST',
    'ENOSPC',
    'EDQUOT',
    'EROFS',
    'EIO',
    'EMFILE',
    'ENFILE',
    'ENAMETOOLONG',
    'EINVAL',
    'EBADF',
    'EXDEV',
    'ENOSYS',
    'EOPNOTSUPP',
])

function fail(): never {
    throw new CoreCommandError('EINVAL', FAILURE)
}

function codeOf(error: unknown): string | undefined {
    if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
    )
        return error.code
    return undefined
}

function descriptorPath(handle: FileHandle): string {
    return `/proc/self/fd/${handle.fd}`
}

function same(left: BigIntStats, right: BigIntStats): boolean {
    return left.ino > 0n && left.ino === right.ino && left.dev === right.dev
}

function absolute(value: string): string {
    if (typeof value !== 'string' || !value.length || value.includes('\0'))
        fail()
    const source = value.startsWith('/') ? value : `${process.cwd()}/${value}`
    const parts: string[] = []
    for (const part of source.split('/')) {
        if (!part || part === '.') continue
        if (part === '..') {
            if (!parts.length) fail()
            parts.pop()
        } else parts.push(part)
    }
    return `/${parts.join('/')}`
}

async function openChild(
    parent: FileHandle,
    name: string,
    create: boolean,
): Promise<FileHandle> {
    const location = `${descriptorPath(parent)}/${name}`
    try {
        return await open(location, DIRECTORY_FLAGS)
    } catch (error) {
        if (!create || codeOf(error) !== 'ENOENT') throw error
        try {
            await mkdir(location, { mode: 0o700 })
        } catch (mkdirError) {
            if (codeOf(mkdirError) !== 'EEXIST') throw mkdirError
        }
        return await open(location, DIRECTORY_FLAGS)
    }
}

async function secure(
    handle: FileHandle,
    directory: boolean,
): Promise<BigIntStats> {
    // Appending '/.' would require search permission and cannot repair mode 000.
    await chmod(descriptorPath(handle), directory ? 0o700 : 0o600)
    const stats = await handle.stat({ bigint: true })
    if (
        (directory ? !stats.isDirectory() : !stats.isFile()) ||
        stats.ino <= 0n ||
        (stats.mode & 0o7777n) !== (directory ? 0o700n : 0o600n)
    )
        fail()
    return stats
}

async function openAbsolute(
    location: string,
    create: boolean,
): Promise<FileHandle> {
    let current = await open('/', DIRECTORY_FLAGS)
    try {
        for (const part of location.split('/').filter(Boolean)) {
            const child = await openChild(current, part, create)
            const previous = current
            current = child
            await previous.close()
        }
        return current
    } catch (error) {
        await current.close()
        throw error
    }
}

async function descend(root: FileHandle, parts: string[]): Promise<FileHandle> {
    let current = root
    try {
        for (const part of parts) {
            const child = await openChild(current, part, true)
            const previous = current
            current = child
            if (previous !== root) await previous.close()
            await secure(current, true)
        }
        return current
    } catch (error) {
        if (current !== root) await current.close()
        throw error
    }
}

async function assertLocation(
    location: string,
    held: FileHandle,
): Promise<void> {
    const fresh = await openAbsolute(location, false)
    try {
        const [heldStats, freshStats] = await Promise.allSettled([
            held.stat({ bigint: true }),
            fresh.stat({ bigint: true }),
        ])
        if (heldStats.status === 'rejected') throw heldStats.reason
        if (freshStats.status === 'rejected') throw freshStats.reason
        if (!same(heldStats.value, freshStats.value)) fail()
    } finally {
        await fresh.close()
    }
}

async function assertLocations(
    rootPath: string,
    root: FileHandle,
    parentPath: string,
    parent: FileHandle,
): Promise<void> {
    const checks = [assertLocation(rootPath, root)]
    if (parentPath !== rootPath) checks.push(assertLocation(parentPath, parent))
    // A failed check must not release descriptors while another check still
    // uses them. These independent observations share no mutable state.
    const results = await Promise.allSettled(checks)
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
}

async function syncDirectory(parent: FileHandle): Promise<void> {
    const readable = await open(
        `${descriptorPath(parent)}/.`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
        await readable.sync()
    } finally {
        await readable.close()
    }
}

async function removeOwnedTemp(
    parentPath: string,
    parent: FileHandle,
    temporary: string,
    owned: BigIntStats,
): Promise<void> {
    try {
        await assertLocation(parentPath, parent)
        if (same(owned, await lstat(temporary, { bigint: true })))
            await unlink(temporary)
    } catch {
        // Cleanup is best effort; a replacement is never removed or retried.
    }
}

async function closeOwned(
    handles: FileHandle[],
    hasPrimaryError: boolean,
): Promise<void> {
    const results = await Promise.allSettled(
        handles.map((handle) => handle.close()),
    )
    const failed = results.find((result) => result.status === 'rejected')
    if (!hasPrimaryError && failed?.status === 'rejected') throw failed.reason
}

async function writePinned(
    input: PrivateStorageFileWriteInput,
    check: () => void,
): Promise<boolean> {
    const rootPath = absolute(input.rootDirectory)
    const target = absolute(input.filePath)
    if (
        rootPath === '/' ||
        !target.startsWith(`${rootPath}/`) ||
        !(input.data instanceof Uint8Array) ||
        input.data.byteLength > CORE_RUNTIME.maxBinaryInputBytes
    )
        fail()
    const parentPath = path.posix.dirname(target)
    const name = path.posix.basename(target)
    let filesystem
    try {
        filesystem = await statfs('/proc/self/fd')
    } catch (error) {
        if (['ENOENT', 'ENOTDIR', 'ENOSYS'].includes(codeOf(error) ?? ''))
            return false
        throw error
    }
    if (filesystem.type !== 0x9fa0) return false
    check()

    let root: FileHandle | undefined
    let parent: FileHandle | undefined
    let file: FileHandle | undefined
    let owned: BigIntStats | undefined
    let temporary: string | undefined
    let published = false
    let hasPrimaryError = false
    try {
        root = await openAbsolute(rootPath, true)
        await secure(root, true)
        parent = await descend(
            root,
            parentPath.slice(rootPath.length).split('/').filter(Boolean),
        )
        temporary = `${descriptorPath(parent)}/.private-file-${randomUUID()}.tmp`
        file = await open(
            temporary,
            constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
            0o600,
        )
        owned = await file.stat({ bigint: true })
        const secured = await secure(file, false)
        if (!same(owned, secured)) fail()
        check()
        await assertLocations(rootPath, root, parentPath, parent)
        // Use the open descriptor directly, without a BunFile/Blob wrapper.
        // Partial writes retain the same owned snapshot until all bytes finish.
        let offset = 0
        while (offset < input.data.byteLength) {
            check()
            const remaining = input.data.byteLength - offset
            const { bytesWritten } = await file.write(
                input.data,
                offset,
                remaining,
                null,
            )
            if (
                !Number.isInteger(bytesWritten) ||
                bytesWritten <= 0 ||
                bytesWritten > remaining
            )
                fail()
            offset += bytesWritten
        }
        const written = await file.stat({ bigint: true })
        if (
            !same(owned, written) ||
            written.size !== BigInt(input.data.byteLength) ||
            !written.isFile() ||
            (written.mode & 0o7777n) !== 0o600n
        )
            fail()
        await file.sync()
        if (!same(owned, await lstat(temporary, { bigint: true }))) fail()
        check()
        await assertLocations(rootPath, root, parentPath, parent)
        await file.close()
        file = undefined
        await rename(temporary, `${descriptorPath(parent)}/${name}`)
        published = true
        await syncDirectory(parent)
        return true
    } catch (error) {
        hasPrimaryError = true
        if (!published && parent && temporary && owned)
            await removeOwnedTemp(parentPath, parent, temporary, owned)
        throw error
    } finally {
        // Settle every owned close before releasing this request's queue slot.
        const handles = [
            file,
            parent !== root ? parent : undefined,
            root,
        ].filter((handle): handle is FileHandle => handle !== undefined)
        await closeOwned(handles, hasPrimaryError)
    }
}

export function isLinuxPrivateStorageWriteSupportedService(): boolean {
    return (
        process.platform === 'linux' &&
        (process.arch === 'x64' || process.arch === 'arm64')
    )
}

export async function writeLinuxPrivateStorageFileService(
    input: PrivateStorageFileWriteInput,
    check: () => void,
): Promise<boolean> {
    if (!isLinuxPrivateStorageWriteSupportedService()) return false
    try {
        return await writePinned(input, check)
    } catch (error) {
        // Node error messages and causes contain private paths; expose only safe codes.
        if (error instanceof CoreCommandError)
            throw new CoreCommandError(error.code, FAILURE, {
                uncertain: error.isUncertain,
            })
        const code = codeOf(error)
        throw new CoreCommandError(
            code && SAFE_CODES.has(code) ? code : 'EIO',
            FAILURE,
        )
    }
}
