import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { BackupImportContext } from '@/server/Admin/Backups/import.types.ts'
import type { ValidatedBackupArchive } from '@/server/Admin/Backups/Types/archive-validation.types.ts'
const source = {
    stat: async () => ({
        dev: 1n,
        ino: 2n,
        size: 100n,
        mtimeNs: 3n,
        ctimeNs: 4n,
    }),
}
let context: BackupImportContext
const result: ValidatedBackupArchive = {
    archiveSize: 100,
    checksumSha256: 'a'.repeat(64),
    manifest: {
        version: 3,
        createdAt: '2026-11-10T09:00:00.000Z',
        appVersion: 'test',
        includesStorage: false,
    },
}
const core = vi.fn(
    async (
        _binary: string,
        _request: Record<string, unknown>,
        _options?: {
            onProgress?: (progress: unknown) => unknown
            validateResult?: (reply: unknown) => unknown
        },
    ) => result,
)
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: core,
}))
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: () => Buffer.alloc(32, 7).toString('base64'),
}))
vi.mock('@/server/Admin/Backups/archive-plaintext.service.ts', () => ({
    withBackupArchiveSourceService: async (
        _input: unknown,
        operation: (input: unknown) => unknown,
    ) => operation({ source, context }),
}))
const { validateBackupArchive, extractBackupArchive, assertChecksumMatches } =
    await import('@/server/Admin/Backups/archive-validation.service.ts')
beforeEach(() => {
    context = {
        signal: new AbortController().signal,
        temporaryDirectory: '/owned',
        maximumUploadBytes: 100,
        assertActive: vi.fn(),
        beforeWrite: vi.fn(async () => undefined),
        markCleanupIncomplete: vi.fn(),
    }
    core.mockClear()
    core.mockImplementation(async (_binary, _request, options) => {
        options?.validateResult?.(result)
        return result
    })
})

describe('Archive validation core boundary', () => {
    it('keeps admission locked after an invalid native reply cannot confirm the outcome', async () => {
        core.mockImplementationOnce(async (_binary, _request, options) => {
            try {
                options?.validateResult?.({ archiveSize: -1 })
            } catch {
                throw Object.assign(new Error('Unbestätigtes Core-Ergebnis'), {
                    code: 'CORE_PROTOCOL_ERROR',
                    isUncertain: true,
                })
            }
            return result
        })
        await expect(
            validateBackupArchive('/archive.enc', context),
        ).rejects.toMatchObject({
            code: 'CORE_PROTOCOL_ERROR',
            isUncertain: true,
        })
        expect(context.markCleanupIncomplete).toHaveBeenCalledTimes(1)
    })
    it('reserves bounded plaintext writes before starting native validation', async () => {
        const deferred = Promise.withResolvers<void>()
        context.beforeWrite = vi.fn(async () => deferred.promise)
        const pending = validateBackupArchive('/archive.enc', context)
        await Promise.resolve()
        await Promise.resolve()
        expect(core).not.toHaveBeenCalled()
        deferred.resolve()
        expect(await pending).toEqual(result)
        expect(context.beforeWrite).toHaveBeenCalledWith(30)
        expect(core.mock.calls[0][1]).toMatchObject({
            operation: 'validate',
            maximumWriteBytes: 30,
            maximumBytes: 100,
            temporaryDirectory: '/owned',
            expectedSourceIdentity: { dev: '1', ino: '2' },
        })
    })
    it('passes cancellation and extraction budgets through the bridge', async () => {
        const progress = vi.fn()
        core.mockImplementationOnce(async (_binary, _request, options) => {
            await options?.onProgress?.({ processedBytes: 50, totalBytes: 100 })
            return result
        })
        expect(
            await extractBackupArchive({
                filePath: '/archive.enc',
                destinationDirectory: '/restore',
                expectedChecksumSha256: 'a'.repeat(64),
                importContext: context,
                onArchiveProgress: progress,
            }),
        ).toEqual(result)
        expect(context.beforeWrite).toHaveBeenCalledWith(60)
        expect(core.mock.calls[0][1]).toMatchObject({
            operation: 'extract',
            maximumWriteBytes: 60,
            destinationDirectory: '/restore',
        })
        expect(progress).toHaveBeenCalledWith(50, 100)
    })
    it('marks uncertain native completion and refuses malformed progress or checksums', async () => {
        core.mockRejectedValueOnce(
            Object.assign(new Error('Native cleanup uncertain'), {
                code: 'ARCHIVE_CLEANUP_INCOMPLETE',
            }),
        )
        await expect(
            validateBackupArchive('/archive.enc', context),
        ).rejects.toThrow()
        expect(context.markCleanupIncomplete).toHaveBeenCalledTimes(1)
        core.mockImplementationOnce(async (_binary, _request, options) => {
            await options?.onProgress?.({
                processedBytes: 101,
                totalBytes: 100,
            })
            return result
        })
        await expect(
            extractBackupArchive({
                filePath: '/archive.enc',
                destinationDirectory: '/restore',
                expectedChecksumSha256: 'a'.repeat(64),
                importContext: context,
            }),
        ).rejects.toThrow('Fortschritt')
        expect(() =>
            assertChecksumMatches('a'.repeat(64), 'b'.repeat(64)),
        ).toThrow()
        expect(() => assertChecksumMatches('a'.repeat(64), 'invalid')).toThrow()
        expect(() =>
            assertChecksumMatches('a'.repeat(64), 'A'.repeat(64)),
        ).not.toThrow()
    })
})
