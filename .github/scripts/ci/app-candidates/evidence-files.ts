import { createHash } from 'node:crypto'
import { byteIdentity } from '../../../../web/src/lib/Marketplace/evidenceIdentity.ts'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, open, opendir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const evidenceLimit = 16 * 1024 * 1024
export const metadataLimit = 512 * 1024
// Allow zstd's small worst-case overhead on a 256 MiB admitted tar.
export const packageLimit = 257 * 1024 * 1024

interface FileIdentity {
    sha256: string
    sizeBytes: number
}

async function readRegularFile<T>(
    path: string,
    limit: number,
    read: (file: Awaited<ReturnType<typeof open>>, size: number) => Promise<T>,
    expected?: FileIdentity,
) {
    const before = await lstat(path)
    if (
        !before.isFile() ||
        before.nlink !== 1 ||
        before.size < 1 ||
        before.size > limit
    ) {
        throw new Error('Invalid candidate evidence file or byte length')
    }
    if (expected && before.size !== expected.sizeBytes)
        throw new Error('Candidate evidence digest or length mismatch')
    const file = await open(
        path,
        constants.O_RDONLY |
            (constants.O_NOFOLLOW ?? 0) |
            (constants.O_NONBLOCK ?? 0),
    )
    try {
        const opened = await file.stat()
        if (
            !opened.isFile() ||
            before.dev !== opened.dev ||
            before.ino !== opened.ino ||
            before.size !== opened.size ||
            opened.nlink !== 1
        ) {
            throw new Error('Candidate evidence file changed before reading')
        }
        const result = await read(file, opened.size)
        const after = await file.stat()
        if (
            opened.size !== after.size ||
            opened.mtimeMs !== after.mtimeMs ||
            opened.ctimeMs !== after.ctimeMs ||
            after.nlink !== 1
        ) {
            throw new Error('Candidate evidence file changed during reading')
        }
        return result
    } finally {
        await file.close()
    }
}

function assertByteIdentity(actual: FileIdentity, expected: FileIdentity) {
    if (
        actual.sha256 !== expected.sha256 ||
        actual.sizeBytes !== expected.sizeBytes
    ) {
        throw new Error('Candidate evidence digest or length mismatch')
    }
}

export function fileIdentity(
    path: string,
    limit: number,
    expected?: FileIdentity,
) {
    return readRegularFile(
        path,
        limit,
        async (file, size) => {
            const hash = createHash('sha256')
            let sizeBytes = 0
            for await (const data of file.createReadStream({
                autoClose: false,
                end: size - 1,
            })) {
                if (!Buffer.isBuffer(data))
                    throw new Error('Invalid candidate evidence bytes')
                sizeBytes += data.length
                hash.update(data)
            }
            if (sizeBytes !== size)
                throw new Error('Candidate evidence file was truncated')
            const identity = { sha256: hash.digest('hex'), sizeBytes }
            if (expected) assertByteIdentity(identity, expected)
            return identity
        },
        expected,
    )
}

export async function readJson(
    path: string,
    limit: number,
    expected?: FileIdentity,
) {
    const bytes = await readRegularFile(
        path,
        limit,
        async (file, size) => {
            const buffer = Buffer.allocUnsafe(size)
            const { bytesRead } = await file.read({ buffer })
            if (bytesRead !== size)
                throw new Error('Candidate evidence file was truncated')
            return buffer
        },
        expected,
    )
    if (expected) assertByteIdentity(byteIdentity(bytes), expected)
    const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    )
    return { bytes, value }
}

export async function assertDirectory(path: string) {
    if (!(await lstat(path)).isDirectory())
        throw new Error('Invalid candidate evidence directory')
}

export async function checkDirectory(
    path: string,
    names: readonly string[],
    allowMissing = false,
) {
    await assertDirectory(path)
    const remaining = new Set(names)
    for await (const entry of await opendir(path)) {
        if (!entry.isFile() || !remaining.delete(entry.name)) {
            throw new Error('Unexpected entry in candidate evidence directory')
        }
    }
    if (!allowMissing && remaining.size > 0)
        throw new Error('Missing files from candidate evidence directory')
}

function hasCode(error: unknown, code: string) {
    return error instanceof Error && 'code' in error && error.code === code
}

// The build owns the destination directory. Reject unrelated content and
// preserve existing files on retries, including bytes from a completed seal.
export async function prepareOutput(path: string, names: readonly string[]) {
    await mkdir(path, { recursive: true })
    await checkDirectory(path, names, true)
}

export async function copyAsset(
    source: string,
    destination: string,
    identity: FileIdentity,
    limit: number,
) {
    try {
        await copyFile(source, destination, constants.COPYFILE_EXCL)
    } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error
        await fileIdentity(destination, limit, identity)
        return
    }
    try {
        await fileIdentity(destination, limit, identity)
    } catch (error) {
        await unlink(destination)
        throw error
    }
}

export async function saveMetadata(
    directory: string,
    name: string,
    bytes: Buffer,
) {
    const path = join(directory, name)
    let file: Awaited<ReturnType<typeof open>>
    try {
        file = await open(path, 'wx')
    } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error
        await fileIdentity(path, metadataLimit, byteIdentity(bytes))
        return
    }
    try {
        try {
            await file.writeFile(bytes)
        } finally {
            await file.close()
        }
    } catch (error) {
        await unlink(path)
        throw error
    }
}
