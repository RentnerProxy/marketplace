import path from 'node:path'
import os from 'node:os'
import * as fileSystem from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    BACKUP_ARCHIVE_ENCRYPTION_CONFIG,
    BACKUP_ARCHIVE_EXTENSION,
    BACKUP_LIMITS,
    BACKUP_TIMEOUTS,
} from '@/config/backup.config.ts'
import type {
    PrepareBackupDownloadInput,
    PreparedBackupDownload,
} from '@/server/Admin/Backups/Types/backup-download.types.ts'

const nativeFileSystem = { ...fileSystem }
const opened = new Set<FileHandle>()
const trackedOpen = vi.fn(
    async (...args: Parameters<typeof fileSystem.open>) => {
        const handle = await nativeFileSystem.open(...args)
        opened.add(handle)
        return handle
    },
)
vi.mock('node:fs/promises', () => ({
    ...nativeFileSystem,
    open: trackedOpen,
}))

let keyByte = 17
let directory = ''
let temporaryRoot = ''
const readKey = vi.fn(() => Buffer.alloc(32, keyByte).toString('base64'))
const getFilePath = vi.fn(async (fileName: string) =>
    path.join(directory, fileName),
)
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: readKey,
}))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupFilePath: getFilePath,
}))

const { encryptBackupArchiveService } =
    await import('./archive-envelope-fixture.test.helpers.ts')
const { prepareBackupDownloadService } =
    await import('@/server/Admin/Backups/download.service.ts')

const preparedDownloads = new Set<PreparedBackupDownload>()

function checksum(data: Uint8Array) {
    return createHash('sha256').update(data).digest('hex')
}

async function fixture(length = 120) {
    const fileName = crypto.randomUUID() + BACKUP_ARCHIVE_EXTENSION
    const filePath = path.join(directory, fileName)
    const plaintext = Buffer.from(
        'private synthetic backup data '.repeat(length),
    )
    const destination = createWriteStream(filePath, {
        flags: 'wx',
        mode: 0o600,
    })
    try {
        const metadata = await encryptBackupArchiveService({
            source: Readable.from([plaintext]),
            destination,
        })
        const bytes = await nativeFileSystem.readFile(filePath)
        return {
            fileName,
            filePath,
            fileSize: metadata.archiveSize,
            checksumSha256: metadata.checksumSha256,
            bytes,
        }
    } finally {
        destination.destroy()
    }
}

async function prepare(input: PrepareBackupDownloadInput) {
    const result = await prepareBackupDownloadService(input)
    preparedDownloads.add(result)
    return result
}

function downloadHandle() {
    expect(opened.size).toBe(1)
    const handle = [...opened][0]
    if (!handle) throw new Error('Expected the download file handle')
    return handle
}

async function expectClosedHandles() {
    expect(opened.size).toBeGreaterThan(0)
    await Promise.all(
        [...opened].map((handle) => expect(handle.stat()).rejects.toThrow()),
    )
}

beforeEach(async function () {
    keyByte = 17
    trackedOpen.mockClear()
    readKey.mockClear()
    getFilePath.mockClear()
    temporaryRoot = await nativeFileSystem.realpath(os.tmpdir())
    directory = await nativeFileSystem.mkdtemp(
        path.join(temporaryRoot, 'backup-download-test-'),
    )
})

afterEach(async function () {
    vi.useRealTimers()
    await Promise.allSettled(
        [...preparedDownloads].map((download) => download.dispose()),
    )
    preparedDownloads.clear()
    await Promise.allSettled([...opened].map((handle) => handle.close()))
    opened.clear()
    const resolved = path.resolve(directory)
    if (
        path.dirname(resolved) !== temporaryRoot ||
        !path.basename(resolved).startsWith('backup-download-test-') ||
        resolved === temporaryRoot
    ) {
        throw new Error('Invalid owned test directory')
    }
    await nativeFileSystem.rm(resolved, { recursive: true, force: true })
})

describe('verified encrypted backup downloads', function () {
    it('authenticates before exposing a body and streams the exact ciphertext from the same open file', async function () {
        const archive = await fixture()
        const before = await nativeFileSystem.readdir(directory)
        const download = await prepare(archive)
        const handle = downloadHandle()

        expect((await handle.stat()).size).toBe(archive.fileSize)
        expect(download.fileSize).toBe(archive.bytes.length)
        expect(readKey).toHaveBeenCalledTimes(2)
        expect(await nativeFileSystem.readdir(directory)).toEqual(before)

        const body = download.createBody()
        expect(() => download.createBody()).toThrow()
        const responseBytes = Buffer.from(
            await new Response(body).arrayBuffer(),
        )
        expect(responseBytes).toEqual(archive.bytes)
        expect(checksum(responseBytes)).toBe(archive.checksumSha256)
        expect(trackedOpen).toHaveBeenCalledTimes(1)
        expect(getFilePath).toHaveBeenCalledTimes(1)
        await expectClosedHandles()
        await expect(download.dispose()).resolves.toBeUndefined()
    })

    it('keeps the verified descriptor when the catalog pathname is replaced before the response', async function () {
        const archive = await fixture()
        const download = await prepare(archive)
        await nativeFileSystem.rename(
            archive.filePath,
            archive.filePath + '.old',
        )
        await nativeFileSystem.writeFile(
            archive.filePath,
            Buffer.alloc(archive.fileSize, 99),
        )
        const body = Buffer.from(
            await new Response(download.createBody()).arrayBuffer(),
        )
        expect(body).toEqual(archive.bytes)
        expect(trackedOpen).toHaveBeenCalledTimes(1)
        await expectClosedHandles()
    })

    it.each([
        'backup.tanstack-backup.tar',
        'backup.tar',
        'backup.tanstack-backup.enc.old',
    ])(
        'rejects legacy catalog filename %s before opening a file',
        async function (fileName) {
            await expect(
                prepare({
                    fileName,
                    fileSize: 120,
                    checksumSha256: 'a'.repeat(64),
                }),
            ).rejects.toMatchObject({ status: 409 })
            expect(getFilePath).not.toHaveBeenCalled()
            expect(trackedOpen).not.toHaveBeenCalled()
            expect(readKey).not.toHaveBeenCalled()
        },
    )

    it.each([
        { fileSize: null, checksumSha256: 'a'.repeat(64) },
        { fileSize: 0, checksumSha256: 'a'.repeat(64) },
        { fileSize: 12.5, checksumSha256: 'a'.repeat(64) },
        {
            fileSize: BACKUP_LIMITS.maxArchiveBytes + 1,
            checksumSha256: 'a'.repeat(64),
        },
        { fileSize: 120, checksumSha256: null },
        { fileSize: 120, checksumSha256: 'not-a-checksum' },
    ])(
        'rejects incomplete catalog metadata before opening a file',
        async function (metadata) {
            await expect(
                prepare({
                    fileName: 'backup' + BACKUP_ARCHIVE_EXTENSION,
                    ...metadata,
                }),
            ).rejects.toMatchObject({ status: 409 })
            expect(trackedOpen).not.toHaveBeenCalled()
            expect(readKey).not.toHaveBeenCalled()
        },
    )

    it.each(['plaintext archive', '', 'short'])(
        'rejects renamed legacy content without trying to use an encryption key',
        async function (legacyContent) {
            const bytes = Buffer.from(legacyContent || 'x')
            const fileName = 'legacy' + BACKUP_ARCHIVE_EXTENSION
            await nativeFileSystem.writeFile(
                path.join(directory, fileName),
                bytes,
            )
            await expect(
                prepare({
                    fileName,
                    fileSize: bytes.length,
                    checksumSha256: checksum(bytes),
                }),
            ).rejects.toMatchObject({ status: 409 })
            expect(readKey).not.toHaveBeenCalled()
            await expectClosedHandles()
        },
    )

    it.each([
        ['version', 8],
        ['algorithm', 9],
        ['salt', 10],
        ['iv', 42],
        ['ciphertext', 54],
        ['tag', -1],
    ] as const)(
        'rejects a modified %s even when the catalog checksum matches the modified file',
        async function (_field, offset) {
            const archive = await fixture()
            const bytes = Buffer.from(archive.bytes)
            const position = offset < 0 ? bytes.length + offset : offset
            bytes[position] = (bytes[position] ?? 0) ^ 1
            await nativeFileSystem.writeFile(archive.filePath, bytes)
            await expect(
                prepare({
                    ...archive,
                    checksumSha256: checksum(bytes),
                }),
            ).rejects.toThrow()
            await expectClosedHandles()
        },
    )

    it('rejects a different installation key without returning a response body', async function () {
        const archive = await fixture()
        keyByte = 18
        await expect(prepare(archive)).rejects.toThrow()
        await expectClosedHandles()
    })

    it('requires the stored ciphertext checksum even for an authentic envelope', async function () {
        const archive = await fixture()
        await expect(
            prepare({
                ...archive,
                checksumSha256: '0'.repeat(64),
            }),
        ).rejects.toThrow()
        await expectClosedHandles()
    })

    it.each([-1, 1])(
        'rejects a catalog size mismatch of %s bytes before key access',
        async function (difference) {
            const archive = await fixture()
            readKey.mockClear()
            await expect(
                prepare({
                    ...archive,
                    fileSize: archive.fileSize + difference,
                }),
            ).rejects.toMatchObject({ status: 400 })
            expect(trackedOpen).not.toHaveBeenCalled()
            expect(readKey).not.toHaveBeenCalled()
        },
    )

    it('rejects a file with multiple hard links before opening it', async function () {
        const archive = await fixture()
        await nativeFileSystem.link(
            archive.filePath,
            archive.filePath + '.linked',
        )
        readKey.mockClear()
        await expect(prepare(archive)).rejects.toMatchObject({ status: 400 })
        expect(trackedOpen).not.toHaveBeenCalled()
        expect(readKey).not.toHaveBeenCalled()
    })

    it('reports an absent file without an open descriptor', async function () {
        await expect(
            prepare({
                fileName: 'absent' + BACKUP_ARCHIVE_EXTENSION,
                fileSize: 100,
                checksumSha256: 'a'.repeat(64),
            }),
        ).rejects.toMatchObject({ status: 404 })
        expect(trackedOpen).not.toHaveBeenCalled()
    })

    it('does not open a file after the request was already aborted', async function () {
        const archive = await fixture()
        const controller = new AbortController()
        controller.abort()
        await expect(
            prepare({
                ...archive,
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({ status: 408 })
        expect(trackedOpen).not.toHaveBeenCalled()
    })

    it('closes an unused verified descriptor when its request is aborted', async function () {
        const archive = await fixture()
        const controller = new AbortController()
        const download = await prepare({
            ...archive,
            signal: controller.signal,
        })
        controller.abort()
        await download.dispose()
        expect(() => download.createBody()).toThrow()
        await expectClosedHandles()
    })

    it('closes after a consumer cancels a partially read body', async function () {
        const archive = await fixture(
            BACKUP_ARCHIVE_ENCRYPTION_CONFIG.chunkBytes,
        )
        const download = await prepare(archive)
        const reader = download.createBody().getReader()
        const first = await reader.read()
        expect(first.done).toBe(false)
        expect(first.value?.length).toBeLessThan(archive.fileSize)
        await reader.cancel()
        await download.dispose()
        await expectClosedHandles()
    })

    it('aborts an active response instead of continuing to stream', async function () {
        const archive = await fixture(
            BACKUP_ARCHIVE_ENCRYPTION_CONFIG.chunkBytes,
        )
        const controller = new AbortController()
        const download = await prepare({
            ...archive,
            signal: controller.signal,
        })
        const reader = download.createBody().getReader()
        expect((await reader.read()).done).toBe(false)
        controller.abort()
        await expect(reader.read()).rejects.toMatchObject({ status: 408 })
        await download.dispose()
        await expectClosedHandles()
    })

    it('bounds the lifetime of a verified descriptor whose body is never consumed', async function () {
        const archive = await fixture()
        vi.useFakeTimers()
        const download = await prepare(archive)
        expect((await downloadHandle().stat()).isFile()).toBe(true)
        vi.advanceTimersByTime(BACKUP_TIMEOUTS.maximumDownloadDurationMs)
        await download.dispose()
        expect(() => download.createBody()).toThrow()
        await expectClosedHandles()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('closes the descriptor and fails the response after a post-verification truncation', async function () {
        const archive = await fixture()
        const download = await prepare(archive)
        await nativeFileSystem.truncate(archive.filePath, 0)
        await expect(
            new Response(download.createBody()).arrayBuffer(),
        ).rejects.toThrow()
        await expectClosedHandles()
    })
})
