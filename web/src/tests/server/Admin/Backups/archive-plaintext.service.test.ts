import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { FileHandle } from 'node:fs/promises'
import type { BackupImportContext } from '@/server/Admin/Backups/Types/import.types.ts'

const release = vi.fn(async () => undefined)
let context: BackupImportContext
const admission = vi.fn(async () => ({ ...context, release }))
vi.mock('@/server/Admin/Backups/import-admission.service.ts', () => ({
    acquireBackupImportAdmissionService: admission,
}))
const { withBackupArchiveSourceService } =
    await import('@/server/Admin/Backups/archive-plaintext.service.ts')
let directory = ''
let sourcePath = ''
beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'archive-source-adapter-'))
    sourcePath = path.join(directory, 'archive.enc')
    await writeFile(sourcePath, Buffer.alloc(100))
    context = {
        signal: new AbortController().signal,
        temporaryDirectory: directory,
        maximumUploadBytes: 100,
        assertActive: vi.fn(),
        beforeWrite: vi.fn(async () => undefined),
        markCleanupIncomplete: vi.fn(),
    }
    admission.mockClear()
    release.mockClear()
})
afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
})

describe('Archive source handle lifecycle', () => {
    it('passes a live owned handle and releases admission after the callback', async () => {
        let source: FileHandle | undefined
        const result = await withBackupArchiveSourceService(
            { filePath: sourcePath },
            async (input) => {
                source = input.source
                expect((await input.source.stat()).size).toBe(100)
                return 'staged'
            },
        )
        expect(result).toBe('staged')
        await expect(source?.stat()).rejects.toThrow()
        expect(release).toHaveBeenCalledTimes(1)
        expect(admission).toHaveBeenCalledTimes(1)
    })
    it('keeps supplied admission under its caller ownership', async () => {
        await withBackupArchiveSourceService(
            { filePath: sourcePath, importContext: context },
            async () => undefined,
        )
        expect(admission).not.toHaveBeenCalled()
        expect(release).not.toHaveBeenCalled()
    })
    it('waits for the callback before closing the handle and releasing the lease', async () => {
        const deferred = Promise.withResolvers<void>()
        const entered = Promise.withResolvers<FileHandle>()
        const pending = withBackupArchiveSourceService(
            { filePath: sourcePath },
            async (input) => {
                entered.resolve(input.source)
                await deferred.promise
            },
        )
        const source = await entered.promise
        expect((await source.stat()).size).toBe(100)
        expect(release).not.toHaveBeenCalled()
        deferred.resolve()
        await pending
        expect(release).toHaveBeenCalledTimes(1)
        await expect(source.stat()).rejects.toThrow()
    })
    it('closes the handle and releases admission when a callback fails', async () => {
        let source: FileHandle | undefined
        await expect(
            withBackupArchiveSourceService(
                { filePath: sourcePath },
                async (input) => {
                    source = input.source
                    throw new Error('callback failed')
                },
            ),
        ).rejects.toThrow('callback failed')
        await expect(source?.stat()).rejects.toThrow()
        expect(release).toHaveBeenCalledTimes(1)
    })
    it('checks source type, size, active context and admitted byte budget', async () => {
        context.maximumUploadBytes = 99
        await expect(
            withBackupArchiveSourceService(
                { filePath: sourcePath, importContext: context },
                async () => undefined,
            ),
        ).rejects.toThrow('Budget')
        await writeFile(sourcePath, 'short')
        await expect(
            withBackupArchiveSourceService(
                { filePath: sourcePath },
                async () => undefined,
            ),
        ).rejects.toThrow('ungültig oder zu groß')
        await expect(
            withBackupArchiveSourceService(
                { filePath: directory },
                async () => undefined,
            ),
        ).rejects.toThrow('ungültig oder zu groß')
        context.assertActive = () => {
            throw new Error('aborted')
        }
        await expect(
            withBackupArchiveSourceService(
                { filePath: '/missing', importContext: context },
                async () => undefined,
            ),
        ).rejects.toThrow('aborted')
    })
})
