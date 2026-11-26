import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import * as coreTransport from '@/server/Core/command.service.ts'
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { getUserPublicImagePaths } from '@/lib/Images/publicImagePaths.ts'
import {
    BACKUP_IMPORT_LIMITS,
    BACKUP_UPLOAD_CONTENT_TYPE,
} from '@/config/backup.config.ts'
import { createTestBackupArchive } from './backupTarTestUtils.ts'
import { readTestBackupTar } from './backup-encryption.test.helpers.ts'
import type { BackupImportContext } from '@/server/Admin/Backups/Types/import.types.ts'
import type { BackupCreationProgress } from '@/lib/Backups/Types/backup.types.ts'
import { CoreCommandError } from '@/server/Core/error.ts'
import { RestoreRollbackError } from '@/server/Admin/Backups/archive-restore.errors.ts'
import { hasUncertainStorageMutationFailureService } from '@/server/Storage/storage-mutation-failure.service.ts'

const nativeCore = { ...coreTransport }
const requests: Record<string, unknown>[] = []
const privateRecoveries = new Set<string>()
const ownedTemporaryDirectories = new Set<string>()
let root = ''
let publicRoot = ''
let privateRoot = ''
let backupRoot = ''
let key = ''
let failure:
    | 'none'
    | 'private-prepare'
    | 'private-uncertain-ack'
    | 'private-commit'
    | 'private-rollback'
    | 'capacity'
    | 'source-cleanup'
    | 'staging-cleanup'
    | 'dump-cleanup' = 'none'
const core = vi.fn(
    async (...args: Parameters<typeof nativeCore.runCoreCommandService>) => {
        const request = args[1]
        requests.push(request)
        const operation = request.operation
        const privateFinish =
            operation === 'recoveryFinish' &&
            privateRecoveries.has(String(request.recoveryDirectory))
        if (
            (failure === 'private-prepare' &&
                operation === 'recoveryPrepare' &&
                request.private === true) ||
            (failure === 'private-commit' &&
                privateFinish &&
                request.action === 'commit') ||
            (failure === 'private-rollback' &&
                privateFinish &&
                request.action === 'rollback') ||
            (failure === 'capacity' && operation === 'capacity') ||
            (failure === 'source-cleanup' &&
                operation === 'remove' &&
                path
                    .basename(String(request.path))
                    .startsWith('restore-source-')) ||
            (failure === 'staging-cleanup' &&
                operation === 'remove' &&
                path
                    .basename(String(request.path))
                    .startsWith('.restore-extracted-')) ||
            (failure === 'dump-cleanup' &&
                operation === 'remove' &&
                path
                    .basename(String(request.path))
                    .startsWith('rentnerproxy-marketplace-backup-'))
        ) {
            throw Object.assign(
                new Error('Synthetic native command failure: ' + failure),
                { code: 'CORE_IO_ERROR' },
            )
        }
        const result = await nativeCore.runCoreCommandService(...args)
        if (operation === 'tempDirectory' && typeof result === 'string')
            ownedTemporaryDirectories.add(result)
        if (
            operation === 'recoveryPrepare' &&
            request.private === true &&
            typeof result === 'object' &&
            result !== null &&
            'recoveryDirectory' in result
        )
            privateRecoveries.add(String(result.recoveryDirectory))
        if (
            failure === 'private-uncertain-ack' &&
            operation === 'recoveryPrepare' &&
            request.private === true
        )
            throw new CoreCommandError(
                'CORE_PROTOCOL_ERROR',
                'Synthetic malformed recovery acknowledgement',
                { uncertain: true },
            )
        return result
    },
)
const dump = vi.fn(async (filePath: string) => {
    await writeFile(filePath, 'current-database')
})
const restore = vi.fn(async (_filePath: string) => undefined)
const logError = vi.fn()
vi.mock('@/server/Admin/SystemSettings/settings.service.ts', () => ({
    getOrCreateSystemSettingsService: async () => ({ companyName: 'Öl & Co' }),
}))
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: core,
}))
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment: (name: string) =>
        name === 'AUTH_ENCRYPTION_KEY'
            ? key
            : name === 'APP_STORAGE_DIR'
              ? publicRoot
              : '',
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logInfo() {},
    logWarn() {},
    logError,
}))
vi.mock('@/server/Admin/Backups/process.service.ts', () => ({
    createPostgresDump: dump,
    restorePostgresDump: restore,
}))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupStoragePaths: () => ({
        backupDirectory: backupRoot,
        storageDirectory: publicRoot,
    }),
    getBackupFilePath: async (name: string) => path.join(backupRoot, name),
}))
vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
    withExclusiveStorageMutationBarrier: async <T>(
        callback: () => Promise<T>,
    ) => callback(),
}))
const { createBackupArchive } =
    await import('@/server/Admin/Backups/archive-create.service.ts')
const { prepareUploadedBackupImport } =
    await import('@/server/Admin/Backups/archive-import.service.ts')
const { acquireBackupImportAdmissionService } =
    await import('@/server/Admin/Backups/import-admission.service.ts')
const { receiveBackupUpload } =
    await import('@/server/Admin/Backups/upload.service.ts')
const { restoreBackupArchive } =
    await import('@/server/Admin/Backups/archive-restore.service.ts')
const { validateBackupArchive, extractBackupArchive } =
    await import('@/server/Admin/Backups/archive-validation.service.ts')

beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'archive-native-workflow-'))
    publicRoot = path.join(root, 'public')
    privateRoot = path.join(root, 'private')
    backupRoot = path.join(root, 'backups')
    await mkdir(publicRoot)
    await mkdir(backupRoot, { mode: 0o700 })
    key = Buffer.alloc(32, 7).toString('base64')
    process.env.APP_PRIVATE_STORAGE_DIR = privateRoot
    process.env.APP_STORAGE_DIR = publicRoot
    process.env.VITE_APP_VERSION = 'test-version'
    failure = 'none'
    requests.length = 0
    privateRecoveries.clear()
    ownedTemporaryDirectories.clear()
    dump.mockClear()
    restore.mockReset().mockResolvedValue(undefined)
    logError.mockClear()
    core.mockClear()
})
afterEach(async () => {
    failure = 'none'
    await rm(root, { recursive: true, force: true })
    await Promise.all(
        [...ownedTemporaryDirectories].map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    )
    delete process.env.APP_PRIVATE_STORAGE_DIR
    delete process.env.APP_STORAGE_DIR
    delete process.env.VITE_APP_VERSION
})
async function writeOwned(filePath: string, content: string) {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
    await writeFile(filePath, content)
}
async function source(includesStorage = true) {
    const filePath = path.join(root, 'source.enc')
    await createTestBackupArchive(filePath, {
        databaseDump: 'source-database',
        includesStorage,
    })
    const expectedChecksumSha256 = createHash('sha256')
        .update(await readFile(filePath))
        .digest('hex')
    return { filePath, expectedChecksumSha256 }
}
async function withAdmittedUpload(
    filePath: string,
    operation: (
        partialPath: string,
        context: BackupImportContext,
    ) => Promise<void>,
) {
    const { size } = await stat(filePath)
    const request = new Request('http://localhost/api/admin/backups/import', {
        method: 'POST',
        headers: {
            'content-type': BACKUP_UPLOAD_CONTENT_TYPE,
            'content-length': String(size),
        },
        body: Bun.file(filePath),
    })
    const context = await acquireBackupImportAdmissionService({
        maximumUploadBytes: size,
        requestSignal: request.signal,
    })
    try {
        const upload = await receiveBackupUpload(request, context)
        try {
            await operation(upload.filePath, context)
        } finally {
            await upload.dispose()
        }
    } finally {
        await context.release()
    }
}
async function snapshot() {
    await writeOwned(path.join(publicRoot, 'asset.txt'), 'snapshot-public')
    const image = getUserPublicImagePaths('alice')
    await writeOwned(image.absoluteBackground, 'snapshot-private')
    const created = await createBackupArchive({ includesStorage: true })
    await writeOwned(path.join(publicRoot, 'asset.txt'), 'current-public')
    await writeOwned(image.absoluteBackground, 'current-private')
    dump.mockClear()
    restore.mockClear()
    return {
        filePath: path.join(backupRoot, created.fileName),
        expectedChecksumSha256: created.checksumSha256,
        image,
    }
}

describe('Native archive workflows', () => {
    it('creates, independently decrypts, validates and extracts encrypted storage archives', async () => {
        await writeOwned(
            path.join(publicRoot, 'nested/Ölbild.txt'),
            'Öfters über den Fluss',
        )
        const progress: BackupCreationProgress[] = []
        const created = await createBackupArchive({
            includesStorage: true,
            onProgress: (value) => {
                progress.push(value)
            },
        })
        const filePath = path.join(backupRoot, created.fileName)
        expect(created.fileName).toMatch(
            /^Oel-Co-\d{4}-\d{2}-\d{2}-\d{2}\.\d{2}\.\d{2}-[a-f0-9]{12}-backup\.enc$/,
        )
        const validated = await validateBackupArchive(filePath)
        expect(created.fileSize).toBe(validated.archiveSize)
        const ciphertext = await readFile(filePath)
        expect(ciphertext.subarray(0, 8).toString()).toBe('TDBAKENC')
        expect(ciphertext.includes(Buffer.from('current-database'))).toBe(false)
        expect(
            (await readTestBackupTar(filePath)).includes(
                Buffer.from('current-database'),
            ),
        ).toBe(true)
        const destinationDirectory = path.join(root, 'new-extraction')
        await extractBackupArchive({
            filePath,
            destinationDirectory,
            expectedChecksumSha256: created.checksumSha256,
        })
        expect(
            await readFile(
                path.join(destinationDirectory, 'database.dump'),
                'utf8',
            ),
        ).toBe('current-database')
        expect(
            await readFile(
                path.join(destinationDirectory, 'storage/nested/Ölbild.txt'),
                'utf8',
            ),
        ).toBe('Öfters über den Fluss')
        const archiving = progress.filter(
            (value) => value.phase === 'archiving',
        )
        expect(archiving[0]?.processedBytes).toBe(0)
        expect(archiving.at(-1)?.processedBytes).toBe(
            archiving.at(-1)?.totalBytes,
        )
        expect(await readdir(backupRoot)).toEqual([created.fileName])
    })
    it.each(['', 'invalid-key', Buffer.alloc(31).toString('base64')])(
        'validates the encryption key before starting a database dump (%s)',
        async (invalidKey) => {
            key = invalidKey
            await expect(
                createBackupArchive({ includesStorage: false }),
            ).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' })
            expect(dump).not.toHaveBeenCalled()
            expect(await readdir(backupRoot)).toEqual([])
        },
    )
    it('keeps backup creation alive if live progress reporting fails', async () => {
        const created = await createBackupArchive({
            includesStorage: false,
            onProgress: async () => {
                throw new Error('progress offline')
            },
        })
        expect(created.fileSize).toBeGreaterThan(70)
        expect(logError).toHaveBeenCalled()
    })
    it('fails closed if its database dump cannot be confirmed removed before validation', async () => {
        failure = 'dump-cleanup'
        await expect(
            createBackupArchive({ includesStorage: false }),
        ).rejects.toThrow('Datenbank-Dump')
        expect(
            requests.some((request) => request.operation === 'validate'),
        ).toBe(false)
        expect(await readdir(backupRoot)).toEqual([])
    })
    it('validates, publishes and rolls back the same file received from the upload', async () => {
        const original = await source(false)
        const originalBytes = await readFile(original.filePath)
        await withAdmittedUpload(
            original.filePath,
            async (partialPath, context) => {
                const uploaded = await stat(partialPath, { bigint: true })
                const imported = await prepareUploadedBackupImport(
                    partialPath,
                    context,
                )
                const destination = path.join(backupRoot, imported.fileName)
                expect(requests).toContainEqual(
                    expect.objectContaining({
                        operation: 'validate',
                        sourcePath: partialPath,
                    }),
                )
                expect(
                    requests.some((request) => request.operation === 'copy'),
                ).toBe(false)
                expect(
                    (await readdir(context.temporaryDirectory)).toSorted(),
                ).toEqual(['admission.json', 'upload.partial'])
                await expect(stat(destination)).rejects.toMatchObject({
                    code: 'ENOENT',
                })

                await imported.publish()
                const published = await stat(destination, { bigint: true })
                expect(published.ino).toBe(uploaded.ino)
                expect(published.dev).toBe(uploaded.dev)
                expect(await readFile(destination)).toEqual(originalBytes)
                await expect(stat(partialPath)).rejects.toMatchObject({
                    code: 'ENOENT',
                })
                await imported.dispose()
                await expect(stat(destination)).rejects.toMatchObject({
                    code: 'ENOENT',
                })
            },
        )
        expect(await readFile(original.filePath)).toEqual(originalBytes)
        expect(await readdir(backupRoot)).toEqual([])
    })
    it('rejects corrupted ciphertext before import publication or restore mutations', async () => {
        const original = await source()
        await writeOwned(path.join(publicRoot, 'current.txt'), 'preserved')
        const bytes = await readFile(original.filePath)
        bytes[54] ^= 1
        await writeFile(original.filePath, bytes)
        await withAdmittedUpload(
            original.filePath,
            async (partialPath, context) => {
                await expect(
                    prepareUploadedBackupImport(partialPath, context),
                ).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' })
            },
        )
        expect(await readdir(backupRoot)).toEqual([])
        await expect(restoreBackupArchive(original)).rejects.toMatchObject({
            code: 'ARCHIVE_INVALID',
        })
        expect(restore).not.toHaveBeenCalled()
        expect(
            await readFile(path.join(publicRoot, 'current.txt'), 'utf8'),
        ).toBe('preserved')
    })
    it('restores complete public and private snapshots while removing subsequently added files', async () => {
        const original = await snapshot()
        await writeOwned(path.join(publicRoot, 'later.txt'), 'later')
        await restoreBackupArchive(original)
        expect(await readFile(path.join(publicRoot, 'asset.txt'), 'utf8')).toBe(
            'snapshot-public',
        )
        expect(await readFile(original.image.absoluteBackground, 'utf8')).toBe(
            'snapshot-private',
        )
        await expect(
            readFile(path.join(publicRoot, 'later.txt')),
        ).rejects.toMatchObject({ code: 'ENOENT' })
        expect(restore).toHaveBeenCalledTimes(1)
        expect(
            (await readdir(root)).some((name) =>
                name.startsWith('.storage-before-'),
            ),
        ).toBe(false)
    })
    it('keeps both storage roots unchanged for a database-only archive', async () => {
        const original = await source(false)
        const image = getUserPublicImagePaths('alice')
        await writeOwned(image.absoluteBackground, 'preserved-private')
        await writeOwned(path.join(publicRoot, 'keep.txt'), 'preserved-public')
        await restoreBackupArchive(original)
        expect(await readFile(image.absoluteBackground, 'utf8')).toBe(
            'preserved-private',
        )
        expect(await readFile(path.join(publicRoot, 'keep.txt'), 'utf8')).toBe(
            'preserved-public',
        )
        expect(
            requests.some((request) => request.operation === 'recoveryPrepare'),
        ).toBe(false)
    })
    it('releases source admission before the journal barrier and storage mutation', async () => {
        const original = await source()
        let barrierObserved = false
        await restoreBackupArchive({
            ...original,
            beforeRestoreMutation: async () => {
                barrierObserved = true
                expect(
                    (await readdir(backupRoot)).includes(
                        BACKUP_IMPORT_LIMITS.admissionDirectoryName,
                    ),
                ).toBe(false)
                expect(
                    requests.some(
                        (request) => request.operation === 'recoveryPrepare',
                    ),
                ).toBe(false)
            },
        })
        expect(barrierObserved).toBe(true)
    })
    it.each(['database', 'after-database', 'catalogue'])(
        'rolls back the database and both storage roots after a %s failure',
        async (stage) => {
            const original = await snapshot()
            if (stage === 'database')
                restore.mockRejectedValueOnce(new Error('database failed'))
            await expect(
                restoreBackupArchive({
                    ...original,
                    ...(stage === 'after-database'
                        ? {
                              afterDatabaseRestore: async () => {
                                  throw new Error('post database failed')
                              },
                          }
                        : {}),
                    ...(stage === 'catalogue'
                        ? {
                              afterRestoreApplied: async () => {
                                  throw new Error('catalogue failed')
                              },
                          }
                        : {}),
                }),
            ).rejects.toThrow()
            expect(
                await readFile(path.join(publicRoot, 'asset.txt'), 'utf8'),
            ).toBe('current-public')
            expect(
                await readFile(original.image.absoluteBackground, 'utf8'),
            ).toBe('current-private')
            expect(restore).toHaveBeenCalledTimes(2)
        },
    )
    it('rolls public storage back if the private native preparation fails', async () => {
        const original = await snapshot()
        failure = 'private-prepare'
        await expect(restoreBackupArchive(original)).rejects.toThrow(
            'private-prepare',
        )
        expect(await readFile(path.join(publicRoot, 'asset.txt'), 'utf8')).toBe(
            'current-public',
        )
        expect(await readFile(original.image.absoluteBackground, 'utf8')).toBe(
            'current-private',
        )
        expect(restore).not.toHaveBeenCalled()
    })
    it('keeps recovery points and reports manual recovery when native rollback fails', async () => {
        const original = await snapshot()
        await expect(
            restoreBackupArchive({
                ...original,
                afterDatabaseRestore: async () => {
                    failure = 'private-rollback'
                    throw new Error('after database failure')
                },
            }),
        ).rejects.toMatchObject({ name: 'RestoreRollbackError' })
        expect(
            (await readdir(root)).some((name) =>
                name.startsWith('.storage-before-'),
            ),
        ).toBe(true)
        expect(
            (await readdir(backupRoot)).some((name) =>
                name.startsWith('.restore-database-before-'),
            ),
        ).toBe(true)
        expect(await readFile(path.join(publicRoot, 'asset.txt'), 'utf8')).toBe(
            'current-public',
        )
    })
    it('retains manual recovery when a native preparation applies storage but its acknowledgement is uncertain', async () => {
        const original = await snapshot()
        failure = 'private-uncertain-ack'
        let restoreFailure: unknown
        try {
            await restoreBackupArchive(original)
        } catch (error) {
            restoreFailure = error
        }
        expect(restoreFailure).toBeInstanceOf(RestoreRollbackError)
        expect(restoreFailure).toMatchObject({
            cause: { code: 'CORE_PROTOCOL_ERROR', isUncertain: true },
        })
        expect(hasUncertainStorageMutationFailureService(restoreFailure)).toBe(
            true,
        )
        expect(restore).not.toHaveBeenCalled()
        // The known public handle rolled back; the unacknowledged private
        // mutation must remain explicitly recoverable rather than called safe.
        expect(await readFile(path.join(publicRoot, 'asset.txt'), 'utf8')).toBe(
            'current-public',
        )
        expect(await readFile(original.image.absoluteBackground, 'utf8')).toBe(
            'snapshot-private',
        )
        const privateRecovery = [...privateRecoveries][0]
        if (!privateRecovery) throw new Error('Missing native recovery fixture')
        expect(
            await readFile(
                path.join(
                    privateRecovery,
                    path.relative(
                        privateRoot,
                        original.image.absoluteBackground,
                    ),
                ),
                'utf8',
            ),
        ).toBe('current-private')
        const databaseRecovery = (await readdir(backupRoot)).find((name) =>
            name.startsWith('.restore-database-before-'),
        )
        if (!databaseRecovery)
            throw new Error('Missing preserved database recovery dump')
        expect(
            await readFile(path.join(backupRoot, databaseRecovery), 'utf8'),
        ).toBe('current-database')
        const extractedStaging = [...ownedTemporaryDirectories].find(
            (directory) =>
                path.basename(directory).startsWith('.restore-extracted-'),
        )
        if (!extractedStaging)
            throw new Error('Missing extracted restore fixture')
        expect(
            await readFile(path.join(extractedStaging, 'database.dump')),
        ).toBeDefined()
        expect(
            requests.some(
                (request) =>
                    request.operation === 'remove' &&
                    request.path === extractedStaging,
            ),
        ).toBe(false)
    })
    it('preserves applied data and the database recovery dump if native final cleanup fails', async () => {
        const original = await snapshot()
        failure = 'private-commit'
        await expect(restoreBackupArchive(original)).rejects.toMatchObject({
            name: 'RestoreRollbackError',
        })
        expect(await readFile(path.join(publicRoot, 'asset.txt'), 'utf8')).toBe(
            'snapshot-public',
        )
        expect(await readFile(original.image.absoluteBackground, 'utf8')).toBe(
            'snapshot-private',
        )
        expect(restore).toHaveBeenCalledTimes(1)
        expect(
            (await readdir(backupRoot)).some((name) =>
                name.startsWith('.restore-database-before-'),
            ),
        ).toBe(true)
    })
    it('rejects mismatched application versions or storage scope before mutation', async () => {
        const original = await source()
        process.env.VITE_APP_VERSION = 'incompatible-version'
        await expect(restoreBackupArchive(original)).rejects.toThrow(
            'App-Version',
        )
        process.env.VITE_APP_VERSION = 'test-version'
        await expect(
            restoreBackupArchive({
                ...original,
                expectedIncludesStorage: false,
            }),
        ).rejects.toThrow('Storage-Umfang')
        expect(restore).not.toHaveBeenCalled()
    })

    it('preserves staging and marks admission incomplete when source cleanup cannot be confirmed', async () => {
        const original = await source(false)
        failure = 'source-cleanup'

        await expect(restoreBackupArchive(original)).rejects.toMatchObject({
            status: 503,
            message: expect.stringContaining(
                'Importbereinigung ist unvollständig',
            ),
        })
        expect(restore).not.toHaveBeenCalled()
        const staging = [...ownedTemporaryDirectories].find((directory) =>
            path.basename(directory).startsWith('.restore-extracted-'),
        )
        if (!staging) throw new Error('Missing restore staging directory')
        expect(
            await readFile(path.join(staging, 'database.dump'), 'utf8'),
        ).toBe('source-database')
        expect(requests.map((request) => request.operation)).toContain(
            'admissionMarkIncomplete',
        )
    })

    it('reports recovery required when plaintext cleanup fails after a successful restore', async () => {
        const original = await source(false)
        failure = 'staging-cleanup'

        await expect(restoreBackupArchive(original)).rejects.toMatchObject({
            name: 'RestoreRollbackError',
            cause: expect.objectContaining({
                message: expect.stringContaining('Backup-Klartext'),
            }),
            rollbackErrors: [expect.any(Error)],
        })
        expect(restore).toHaveBeenCalledTimes(1)
    })
})
