import path from 'node:path'
import os from 'node:os'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { CoreCommandError } from '@/server/Core/error.ts'
import type { BackupImportContext } from '@/server/Admin/Backups/Types/import.types.ts'
import { createBackupImportTestContext } from './import-context.test.helpers.ts'

let directory = ''
let partialPath = ''
let fixture: ReturnType<typeof createBackupImportTestContext>
const uploadBytes = Buffer.alloc(100, 1)
const validatedArchive = {
    archiveSize: uploadBytes.length,
    checksumSha256: 'a'.repeat(64),
    manifest: {
        version: 3,
        createdAt: '2026-11-10T09:00:00.000Z',
        appVersion: 'test',
        includesStorage: false,
    },
}
const validate = vi.fn(
    async (_path: string, _context: BackupImportContext) => validatedArchive,
)
const publish = vi.fn(rename)
const cleanup = vi.fn(async (_path: string, _event: string) => true)

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

const { prepareUploadedBackupImport } =
    await import('@/server/Admin/Backups/archive-import.service.ts')

beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'archive-import-adapter-'))
    partialPath = path.join(directory, 'upload.partial')
    await writeFile(partialPath, uploadBytes, { flag: 'wx', mode: 0o600 })
    fixture = createBackupImportTestContext(directory, uploadBytes.length)
    validate.mockReset().mockResolvedValue(validatedArchive)
    publish.mockReset().mockImplementation(rename)
    cleanup.mockReset().mockImplementation(async (target) => {
        await rm(target, { force: true })
        return true
    })
})
afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
})

describe('Uploaded backup preparation', () => {
    it('validates the owned upload and defers publication to the caller', async () => {
        const staged = await prepareUploadedBackupImport(
            partialPath,
            fixture.context,
        )
        const destination = path.join(directory, staged.fileName)
        expect(validate).toHaveBeenCalledWith(partialPath, fixture.context)
        expect(fixture.beforeWrite).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
        expect(staged).toMatchObject({
            fileSize: uploadBytes.length,
            checksumSha256: validatedArchive.checksumSha256,
            includesStorage: false,
        })
        await expect(readFile(destination)).rejects.toMatchObject({
            code: 'ENOENT',
        })
        await staged.publish()
        expect(await readFile(destination)).toEqual(uploadBytes)
        expect(publish).toHaveBeenCalledWith(partialPath, destination, {
            signal: fixture.context.signal,
        })
        await staged.dispose()
        await expect(readFile(destination)).rejects.toMatchObject({
            code: 'ENOENT',
        })
    })

    it('leaves an invalid partial file with the upload owner', async () => {
        const error = new Error('Invalid authenticated archive')
        validate.mockRejectedValueOnce(error)
        await expect(
            prepareUploadedBackupImport(partialPath, fixture.context),
        ).rejects.toBe(error)
        expect(publish).not.toHaveBeenCalled()
        expect(cleanup).not.toHaveBeenCalled()
        expect(await readFile(partialPath)).toEqual(uploadBytes)
    })

    it('retains admission when removing the confirmed publication fails', async () => {
        const staged = await prepareUploadedBackupImport(
            partialPath,
            fixture.context,
        )
        await staged.publish()
        cleanup.mockResolvedValueOnce(false)
        await expect(staged.dispose()).rejects.toThrow(
            'Die Importdatei konnte nicht vollständig entfernt werden.',
        )
        expect(cleanup).toHaveBeenCalledTimes(1)
        expect(cleanup).toHaveBeenCalledWith(
            path.join(directory, staged.fileName),
            'backup.import.rollback_file_cleanup_failed',
        )
        expect(fixture.markCleanupIncomplete).toHaveBeenCalledTimes(1)
    })

    it('retains admission and leaves cleanup with the upload owner after uncertain publication', async () => {
        const staged = await prepareUploadedBackupImport(
            partialPath,
            fixture.context,
        )
        const error = new CoreCommandError(
            'CORE_OPERATION_UNCERTAIN',
            'Publication was not confirmed',
            { uncertain: true },
        )
        publish.mockRejectedValueOnce(error)
        await expect(staged.publish()).rejects.toBe(error)
        expect(fixture.markCleanupIncomplete).toHaveBeenCalledTimes(1)
        await staged.dispose()
        expect(cleanup).not.toHaveBeenCalled()
        expect(await readFile(partialPath)).toEqual(uploadBytes)
    })

    it('checks cancellation before validation and before publication', async () => {
        const initial = createBackupImportTestContext(directory)
        const error = new Error('Import aborted')
        initial.controller.abort(error)
        await expect(
            prepareUploadedBackupImport(partialPath, initial.context),
        ).rejects.toBe(error)
        expect(validate).not.toHaveBeenCalled()

        const staged = await prepareUploadedBackupImport(
            partialPath,
            fixture.context,
        )
        fixture.controller.abort(error)
        await expect(staged.publish()).rejects.toBe(error)
        await staged.dispose()
        expect(publish).not.toHaveBeenCalled()
        expect(cleanup).not.toHaveBeenCalled()
    })

    it('rolls back a confirmed publication if admission aborts when it completes', async () => {
        const staged = await prepareUploadedBackupImport(
            partialPath,
            fixture.context,
        )
        const destination = path.join(directory, staged.fileName)
        const error = new Error('Import aborted after publication')
        publish.mockImplementationOnce(async (source, target) => {
            await rename(source, target)
            fixture.controller.abort(error)
        })
        await expect(staged.publish()).rejects.toBe(error)
        expect(await readFile(destination)).toEqual(uploadBytes)
        await staged.dispose()
        await expect(readFile(destination)).rejects.toMatchObject({
            code: 'ENOENT',
        })
    })
})
