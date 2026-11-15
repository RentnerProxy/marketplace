import path from 'node:path'
import os from 'node:os'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { BackupImportContext } from '@/server/Admin/Backups/import.types.ts'
import { CoreCommandError } from '@/server/Core/error.ts'
let directory = ''
const core = vi.fn(
    async (_binary: string, request: Record<string, unknown>) => {
        await copyFile(
            String(request.sourcePath),
            String(request.destinationPath),
        )
        return { archiveSize: 100, checksumSha256: 'a'.repeat(64) }
    },
)
const validate = vi.fn(async () => ({
    archiveSize: 100,
    checksumSha256: 'a'.repeat(64),
    manifest: {
        version: 3,
        createdAt: '2026-11-10T09:00:00.000Z',
        appVersion: 'test',
        includesStorage: false,
    },
}))
const publish = vi.fn(async (source: string, destination: string) => {
    await copyFile(source, destination)
    await rm(source)
})
const cleanup = vi.fn(async (filePath: string) => {
    await rm(filePath, { force: true })
    return true
})
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: core,
}))
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: () => Buffer.alloc(32, 7).toString('base64'),
}))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupFilePath: async (name: string) => path.join(directory, name),
}))
vi.mock('@/server/Admin/Backups/archive-validation.service.ts', () => ({
    validateBackupArchive: validate,
}))
vi.mock('@/server/Admin/Backups/archive-files.service.ts', () => ({
    removePathBestEffort: cleanup,
}))
vi.mock('@/server/Admin/Backups/backup-files.service.ts', () => ({
    publishBackupFileService: publish,
}))
const { copyImportedBackup } =
    await import('@/server/Admin/Backups/archive-import.service.ts')
let sourcePath = ''
let context: BackupImportContext
beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'archive-import-adapter-'))
    sourcePath = path.join(directory, 'upload.enc')
    await writeFile(sourcePath, Buffer.alloc(100, 1))
    context = {
        signal: new AbortController().signal,
        temporaryDirectory: directory,
        maximumUploadBytes: 100,
        assertActive: vi.fn(),
        beforeWrite: vi.fn(async () => undefined),
        markCleanupIncomplete: vi.fn(),
    }
    core.mockClear()
    validate.mockClear()
    publish.mockReset()
    publish.mockImplementation(async (source, destination) => {
        await copyFile(source, destination)
        await rm(source)
    })
    cleanup.mockClear()
    core.mockImplementation(async (_binary, request) => {
        await copyFile(
            String(request.sourcePath),
            String(request.destinationPath),
        )
        return { archiveSize: 100, checksumSha256: 'a'.repeat(64) }
    })
    validate.mockImplementation(async () => ({
        archiveSize: 100,
        checksumSha256: 'a'.repeat(64),
        manifest: {
            version: 3,
            createdAt: '2026-11-10T09:00:00.000Z',
            appVersion: 'test',
            includesStorage: false,
        },
    }))
    cleanup.mockImplementation(async (target) => {
        await rm(target, { force: true })
        return true
    })
})
afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
})

describe('Imported backup native-copy adapter', () => {
    it('reserves the copy budget and validates only after native completion', async () => {
        const staged = await copyImportedBackup(sourcePath, context)
        expect(context.beforeWrite).toHaveBeenCalledWith(100)
        expect(core.mock.calls[0][1]).toMatchObject({
            operation: 'copy',
            sourcePath,
            maximumWriteBytes: 100,
            maximumBytes: 100,
            expectedSourceIdentity: { size: '100' },
        })
        expect(validate).toHaveBeenCalledTimes(1)
        expect(publish).not.toHaveBeenCalled()
        await staged.publish()
        expect(await readFile(path.join(directory, staged.fileName))).toEqual(
            Buffer.alloc(100, 1),
        )
        expect(publish).toHaveBeenCalledTimes(1)
        expect(publish.mock.calls[0]?.[1]).toBe(
            path.join(directory, staged.fileName),
        )
        await staged.dispose()
        await expect(
            readFile(path.join(directory, staged.fileName)),
        ).rejects.toThrow()
    })
    it('does not claim or remove an output when native exclusive creation fails', async () => {
        core.mockRejectedValueOnce(
            Object.assign(new Error('Native destination exists'), {
                code: 'EEXIST',
            }),
        )
        await expect(copyImportedBackup(sourcePath, context)).rejects.toThrow(
            'exists',
        )
        expect(cleanup).not.toHaveBeenCalled()
        expect(validate).not.toHaveBeenCalled()
    })
    it('cleans an owned partial if validation fails and aggregates cleanup failure', async () => {
        validate.mockRejectedValueOnce(
            new Error('Invalid authenticated archive'),
        )
        await expect(copyImportedBackup(sourcePath, context)).rejects.toThrow(
            'Invalid authenticated archive',
        )
        expect(cleanup).toHaveBeenCalledTimes(1)
        validate.mockRejectedValueOnce(
            new Error('Invalid authenticated archive'),
        )
        cleanup.mockResolvedValueOnce(false)
        await expect(
            copyImportedBackup(sourcePath, context),
        ).rejects.toBeInstanceOf(AggregateError)
        expect(context.markCleanupIncomplete).toHaveBeenCalledTimes(1)
    })
    it('attempts both published and partial cleanup and reports incomplete rollback', async () => {
        const staged = await copyImportedBackup(sourcePath, context)
        await staged.publish()
        cleanup.mockResolvedValueOnce(false)
        await expect(staged.dispose()).rejects.toBeInstanceOf(AggregateError)
        expect(cleanup).toHaveBeenCalledTimes(2)
        expect(context.markCleanupIncomplete).toHaveBeenCalledTimes(1)
    })
    it('retains uncertainty after an unconfirmed native publication', async () => {
        const staged = await copyImportedBackup(sourcePath, context)
        publish.mockRejectedValueOnce(
            new CoreCommandError(
                'CORE_OPERATION_UNCERTAIN',
                'Die Veröffentlichung ist unbestätigt.',
                { uncertain: true },
            ),
        )
        await expect(staged.publish()).rejects.toMatchObject({
            isUncertain: true,
        })
        expect(context.markCleanupIncomplete).toHaveBeenCalledTimes(1)
        await staged.dispose()
        expect(cleanup).toHaveBeenCalledTimes(1)
        expect(cleanup.mock.calls[0]?.[0]).not.toBe(
            path.join(directory, staged.fileName),
        )
    })
    it('honours aborts and admitted byte limits before writing', async () => {
        context.maximumUploadBytes = 99
        await expect(copyImportedBackup(sourcePath, context)).rejects.toThrow(
            'Größenlimit',
        )
        expect(core).not.toHaveBeenCalled()
        context.assertActive = () => {
            throw new Error('aborted')
        }
        await expect(copyImportedBackup(sourcePath, context)).rejects.toThrow(
            'aborted',
        )
    })
})
