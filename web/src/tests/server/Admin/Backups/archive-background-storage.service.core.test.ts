import * as coreTransport from '@/server/Core/command.service.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import * as fileSystem from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { getUserPublicImagePaths } from '@/lib/Images/publicImagePaths.ts'

import { createTestBackupArchive } from './backupTarTestUtils.ts'
import { RestoreRollbackError } from '@/server/Admin/Backups/archive-restore.errors.ts'

const actualFs = { ...fileSystem }
const actualCore = { ...coreTransport }
const privateRecoveryDirectories = new Set<string>()
const posixTest = process.platform === 'win32' ? it.skip : it
const state = {
    root: '',
    publicRoot: '',
    privateRoot: '',
    backupRoot: '',
    failPrivateOpenCount: 0,
    collidePrivateOpenOnce: false,
    failPrivateCleanup: false,
}
const runCore = vi.fn(
    async (...args: Parameters<typeof actualCore.runCoreCommandService>) => {
        const request = args[1]
        const privateFinish =
            request.operation === 'recoveryFinish' &&
            privateRecoveryDirectories.has(String(request.recoveryDirectory))
        if (
            state.failPrivateOpenCount > 0 &&
            ((request.operation === 'recoveryPrepare' &&
                request.private === true) ||
                (privateFinish && request.action === 'rollback'))
        ) {
            state.failPrivateOpenCount -= 1
            throw Object.assign(
                new Error('Synthetic native private write failure'),
                { code: 'CORE_IO_ERROR' },
            )
        }
        if (
            state.failPrivateCleanup &&
            privateFinish &&
            request.action === 'commit'
        ) {
            throw Object.assign(
                new Error('Synthetic native recovery cleanup failure'),
                { code: 'CORE_IO_ERROR' },
            )
        }
        if (
            state.collidePrivateOpenOnce &&
            request.operation === 'recoveryPrepare' &&
            request.private === true
        ) {
            state.collidePrivateOpenOnce = false
            const relative = (request.restoredRelativeFilePaths as string[])[0]
            if (!relative)
                throw new Error('Synthetic restored background missing')
            await writeOwned(
                path.join(state.privateRoot, relative),
                'synthetic-competing-file',
            )
        }
        const result = await actualCore.runCoreCommandService(...args)
        if (
            request.operation === 'recoveryPrepare' &&
            request.private === true &&
            typeof result === 'object' &&
            result !== null &&
            'recoveryDirectory' in result
        )
            privateRecoveryDirectories.add(String(result.recoveryDirectory))
        return result
    },
)
vi.mock('@/server/Core/command.service.ts', () => ({
    runCoreCommandService: runCore,
}))
const logError = vi.fn()
const logWarn = vi.fn()
const createDump = vi.fn(async (filePath: string) => {
    await actualFs.writeFile(filePath, 'synthetic-current-database', {
        mode: 0o600,
    })
})
const restoreDump = vi.fn(async (_filePath: string) => {})
vi.mock('@/server/Admin/SystemSettings/settings.service.ts', () => ({
    getOrCreateSystemSettingsService: async () => ({ companyName: 'Öl & Co' }),
}))
vi.mock('@/server/Runtime/environment.service.ts', () => ({
    getRequiredServerEnvironment(key: string) {
        if (key === 'APP_STORAGE_DIR') return state.publicRoot
        if (key === 'AUTH_ENCRYPTION_KEY')
            return Buffer.alloc(32, 19).toString('base64')
        throw new Error('Unexpected synthetic environment key')
    },
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logError,
    logWarn,
    logInfo: vi.fn(),
}))
vi.mock('@/server/Admin/Backups/process.service.ts', () => ({
    createPostgresDump: createDump,
    restorePostgresDump: restoreDump,
}))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupStoragePaths() {
        return {
            backupDirectory: state.backupRoot,
            storageDirectory: state.publicRoot,
        }
    },
    async getBackupFilePath(fileName: string) {
        return path.join(state.backupRoot, fileName)
    },
}))
vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
    async withExclusiveStorageMutationBarrier<T>(callback: () => Promise<T>) {
        return callback()
    },
}))

const { createBackupArchive } =
    await import('@/server/Admin/Backups/archive-create.service.ts')
const { restoreBackupArchive } =
    await import('@/server/Admin/Backups/archive-restore.service.ts')
const { extractBackupArchive, validateBackupArchive } =
    await import('@/server/Admin/Backups/archive-validation.service.ts')
const {
    collectBackgroundStorageFilesService,
    getBackgroundStorageLayoutService,
    assertBackgroundStoragePathsService,
} = await import('@/server/Admin/Backups/archive-background-storage.service.ts')
const { assertStorageRecoveryCapacityService } =
    await import('@/server/Admin/Backups/archive-storage-recovery.service.ts')

beforeEach(async () => {
    vi.clearAllMocks()
    state.root = await actualFs.mkdtemp(
        path.join(os.tmpdir(), 'backup-private-snapshot-'),
    )
    state.publicRoot = path.join(state.root, 'public')
    state.privateRoot = path.join(state.root, 'private')
    state.backupRoot = path.join(state.root, 'backups')
    await actualFs.mkdir(state.publicRoot, { mode: 0o700 })
    await actualFs.mkdir(state.backupRoot, { mode: 0o700 })
    process.env.APP_STORAGE_DIR = state.publicRoot
    process.env.APP_PRIVATE_STORAGE_DIR = state.privateRoot
    process.env.VITE_APP_VERSION = 'private-snapshot-test'
    process.env.AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString('base64')
    privateRecoveryDirectories.clear()
    state.failPrivateOpenCount = 0
    state.collidePrivateOpenOnce = false
    state.failPrivateCleanup = false

    restoreDump.mockReset().mockResolvedValue(undefined)
    createDump.mockClear()
})

afterEach(async () => {
    delete process.env.APP_STORAGE_DIR
    delete process.env.APP_PRIVATE_STORAGE_DIR
    delete process.env.VITE_APP_VERSION
    delete process.env.AUTH_ENCRYPTION_KEY
    state.failPrivateCleanup = false
    const resolved = path.resolve(state.root)
    if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('backup-private-snapshot-')
    ) {
        throw new Error('Invalid synthetic cleanup target')
    }
    await actualFs.rm(resolved, { recursive: true, force: true })
})

async function writeOwned(filePath: string, content: string) {
    await actualFs.mkdir(path.dirname(filePath), {
        recursive: true,
        mode: 0o700,
    })
    await actualFs.writeFile(filePath, content, { mode: 0o600 })
}

function archiveBackgroundPath(userId: string) {
    return (
        'storage/' +
        path
            .relative(
                state.publicRoot,
                getUserPublicImagePaths(userId).absoluteLegacyBackground,
            )
            .split(path.sep)
            .join('/')
    )
}

async function createSnapshot(includesStorage = true) {
    const result = await createBackupArchive({ includesStorage })
    return {
        filePath: path.join(state.backupRoot, result.fileName),
        expectedChecksumSha256: result.checksumSha256,
    }
}

async function createHistoricalSnapshot(users: string[] = []) {
    const filePath = path.join(state.backupRoot, 'historical.tdbak')
    await createTestBackupArchive(filePath, {
        includesStorage: true,
        databaseDump: 'synthetic-previous-database',
        manifest: {
            version: 2,
            includesStorage: true,
            createdAt: new Date().toISOString(),
            appVersion: 'private-snapshot-test',
        },
        extraEntries: users.map((userId) => ({
            name: archiveBackgroundPath(userId),
            content: 'historical-' + userId,
        })),
    })
    const validated = await validateBackupArchive(filePath)
    return { filePath, expectedChecksumSha256: validated.checksumSha256 }
}

describe('Private background archive coverage', () => {
    it('authenticates a v3 private-only image at the existing logical path', async () => {
        const image = getUserPublicImagePaths('private-user')
        await writeOwned(image.absoluteBackground, 'private-snapshot-bytes')
        const source = await createSnapshot()
        const extraction = path.join(state.root, 'verified')
        await actualFs.mkdir(extraction)
        const validated = await extractBackupArchive({
            ...source,
            destinationDirectory: extraction,
        })
        expect(validated.manifest).toMatchObject({
            version: 3,
            includesStorage: true,
            privateBackgroundsVersion: 1,
        })
        expect(
            await actualFs.readFile(
                path.join(extraction, archiveBackgroundPath('private-user')),
                'utf8',
            ),
        ).toBe('private-snapshot-bytes')
        await expect(
            actualFs.lstat(image.absoluteLegacyBackground),
        ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('prefers private bytes over a duplicate legacy file and excludes unrelated private data', async () => {
        const image = getUserPublicImagePaths('dual-user')
        await writeOwned(image.absoluteBackground, 'private-winner')
        await writeOwned(image.absoluteLegacyBackground, 'legacy-loser')
        await writeOwned(
            path.join(state.privateRoot, 'unrelated-control'),
            'private-control',
        )
        const source = await createSnapshot()
        const extraction = path.join(state.root, 'verified')
        await actualFs.mkdir(extraction)
        await extractBackupArchive({
            ...source,
            destinationDirectory: extraction,
        })
        expect(
            await actualFs.readFile(
                path.join(extraction, archiveBackgroundPath('dual-user')),
                'utf8',
            ),
        ).toBe('private-winner')
        await expect(
            actualFs.lstat(
                path.join(extraction, 'storage', 'unrelated-control'),
            ),
        ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('restores public and complete private snapshots and removes private images added later', async () => {
        const original = getUserPublicImagePaths('original-user')
        const added = getUserPublicImagePaths('added-later')
        await writeOwned(original.absoluteBackground, 'snapshot-image')
        await writeOwned(
            path.join(state.publicRoot, 'public-file'),
            'snapshot-public',
        )
        const source = await createSnapshot()
        await writeOwned(original.absoluteBackground, 'later-image')
        await writeOwned(added.absoluteBackground, 'later-added')
        await writeOwned(
            path.join(original.absoluteBackgroundDir, 'unrelated-private'),
            'preserve-unrelated',
        )
        await writeOwned(
            path.join(state.publicRoot, 'public-file'),
            'later-public',
        )
        await restoreBackupArchive(source)
        expect(
            await actualFs.readFile(original.absoluteBackground, 'utf8'),
        ).toBe('snapshot-image')
        await expect(
            actualFs.lstat(added.absoluteBackground),
        ).rejects.toMatchObject({ code: 'ENOENT' })
        expect(
            await actualFs.readFile(
                path.join(original.absoluteBackgroundDir, 'unrelated-private'),
                'utf8',
            ),
        ).toBe('preserve-unrelated')
        expect(
            await actualFs.readFile(
                path.join(state.publicRoot, 'public-file'),
                'utf8',
            ),
        ).toBe('snapshot-public')
        await expect(
            actualFs.lstat(original.absoluteLegacyBackground),
        ).rejects.toMatchObject({ code: 'ENOENT' })
        expect(restoreDump).toHaveBeenCalledTimes(1)
    })

    it('treats authenticated empty v3 coverage as a complete empty background snapshot', async () => {
        const source = await createSnapshot()
        const image = getUserPublicImagePaths('new-user')
        await writeOwned(image.absoluteBackground, 'later-image')
        await writeOwned(
            path.join(state.privateRoot, 'other-private'),
            'retain',
        )
        await restoreBackupArchive(source)
        await expect(
            actualFs.lstat(image.absoluteBackground),
        ).rejects.toMatchObject({ code: 'ENOENT' })
        expect(
            await actualFs.readFile(
                path.join(state.privateRoot, 'other-private'),
                'utf8',
            ),
        ).toBe('retain')
    })

    it('keeps existing v2 private copies unchanged and installs only missing legacy copies privately', async () => {
        const existing = getUserPublicImagePaths('existing-user')
        const missing = getUserPublicImagePaths('missing-user')
        await writeOwned(existing.absoluteBackground, 'current-private-wins')
        const before = await actualFs.lstat(existing.absoluteBackground, {
            bigint: true,
        })
        const source = await createHistoricalSnapshot([
            'existing-user',
            'missing-user',
        ])
        await restoreBackupArchive(source)
        const after = await actualFs.lstat(existing.absoluteBackground, {
            bigint: true,
        })
        expect(after.ino).toBe(before.ino)
        expect(after.mtimeNs).toBe(before.mtimeNs)
        expect(
            await actualFs.readFile(existing.absoluteBackground, 'utf8'),
        ).toBe('current-private-wins')
        expect(
            await actualFs.readFile(missing.absoluteBackground, 'utf8'),
        ).toBe('historical-missing-user')
        await expect(
            actualFs.lstat(existing.absoluteLegacyBackground),
        ).rejects.toMatchObject({ code: 'ENOENT' })
        await expect(
            actualFs.lstat(missing.absoluteLegacyBackground),
        ).rejects.toMatchObject({ code: 'ENOENT' })
        expect(logWarn).toHaveBeenCalledWith(
            'backup.restore.legacy_private_background_coverage',
            { manifestVersion: 2, completePrivateSnapshot: false },
        )
    })

    it('preserves every existing private image when v2 has no legacy background entries', async () => {
        const image = getUserPublicImagePaths('only-private')
        await writeOwned(image.absoluteBackground, 'untouched')
        const before = await actualFs.lstat(image.absoluteBackground, {
            bigint: true,
        })
        await restoreBackupArchive(await createHistoricalSnapshot())
        expect(
            (await actualFs.lstat(image.absoluteBackground, { bigint: true }))
                .ino,
        ).toBe(before.ino)
        expect(await actualFs.readFile(image.absoluteBackground, 'utf8')).toBe(
            'untouched',
        )
    })

    it('leaves private and public storage unchanged for database-only v3 archives', async () => {
        const image = getUserPublicImagePaths('database-only')
        await writeOwned(image.absoluteBackground, 'private-kept')
        await writeOwned(
            path.join(state.publicRoot, 'public-kept'),
            'public-kept',
        )
        const source = await createSnapshot(false)
        await restoreBackupArchive(source)
        expect(await actualFs.readFile(image.absoluteBackground, 'utf8')).toBe(
            'private-kept',
        )
        expect(
            await actualFs.readFile(
                path.join(state.publicRoot, 'public-kept'),
                'utf8',
            ),
        ).toBe('public-kept')
        expect(
            (await validateBackupArchive(source.filePath)).manifest,
        ).not.toHaveProperty('privateBackgroundsVersion')
    })

    it.each([undefined, 0, 2, false, '1'])(
        'rejects an invalid v3 coverage marker before any restore side effect: %s',
        async (marker) => {
            const filePath = path.join(state.backupRoot, 'invalid.tdbak')
            await createTestBackupArchive(filePath, {
                includesStorage: true,
                databaseDump: 'synthetic',
                manifest: {
                    version: 3,
                    includesStorage: true,
                    appVersion: 'private-snapshot-test',
                    createdAt: new Date().toISOString(),
                    ...(marker === undefined
                        ? {}
                        : { privateBackgroundsVersion: marker }),
                },
            })
            const expectedChecksumSha256 = createHash('sha256')
                .update(await actualFs.readFile(filePath))
                .digest('hex')
            await expect(
                restoreBackupArchive({ filePath, expectedChecksumSha256 }),
            ).rejects.toThrow()
            expect(createDump).not.toHaveBeenCalled()
            expect(restoreDump).not.toHaveBeenCalled()
        },
    )

    it.each([2, 3])(
        'rejects marker fields outside the exact v3 storage contract: %s',
        async (version) => {
            const filePath = path.join(state.backupRoot, 'extra-marker.tdbak')
            await createTestBackupArchive(filePath, {
                includesStorage: version === 2,
                databaseDump: 'synthetic',
                manifest: {
                    version,
                    includesStorage: version === 2,
                    privateBackgroundsVersion: 1,
                    appVersion: 'private-snapshot-test',
                    createdAt: new Date().toISOString(),
                },
            })
            await expect(validateBackupArchive(filePath)).rejects.toThrow()
        },
    )

    it('rejects a changed authenticated archive before either storage root is touched', async () => {
        const image = getUserPublicImagePaths('authenticated')
        await writeOwned(image.absoluteBackground, 'private-current')
        const source = await createSnapshot()
        const bytes = await actualFs.readFile(source.filePath)
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1
        await actualFs.writeFile(source.filePath, bytes)
        createDump.mockClear()
        await expect(
            restoreBackupArchive({
                ...source,
                expectedChecksumSha256: createHash('sha256')
                    .update(bytes)
                    .digest('hex'),
            }),
        ).rejects.toThrow()
        expect(createDump).not.toHaveBeenCalled()
        expect(restoreDump).not.toHaveBeenCalled()
        expect(await actualFs.readFile(image.absoluteBackground, 'utf8')).toBe(
            'private-current',
        )
    })

    it.each(['database', 'after-database'])(
        'rolls both storage roots back after %s failure',
        async (failure) => {
            const image = getUserPublicImagePaths('rollback-user')
            await writeOwned(image.absoluteBackground, 'snapshot-private')
            await writeOwned(
                path.join(state.publicRoot, 'public-file'),
                'snapshot-public',
            )
            const source = await createSnapshot()
            await writeOwned(image.absoluteBackground, 'before-private')
            await writeOwned(
                path.join(state.publicRoot, 'public-file'),
                'before-public',
            )
            if (failure === 'database')
                restoreDump.mockRejectedValueOnce(
                    new Error('Synthetic database failure'),
                )
            await expect(
                restoreBackupArchive({
                    ...source,
                    ...(failure === 'after-database'
                        ? {
                              afterDatabaseRestore: async () => {
                                  throw new Error(
                                      'Synthetic post-database failure',
                                  )
                              },
                          }
                        : {}),
                }),
            ).rejects.toThrow()
            expect(
                await actualFs.readFile(image.absoluteBackground, 'utf8'),
            ).toBe('before-private')
            expect(
                await actualFs.readFile(
                    path.join(state.publicRoot, 'public-file'),
                    'utf8',
                ),
            ).toBe('before-public')
            expect(restoreDump).toHaveBeenCalledTimes(2)
        },
    )

    it('rolls the public root back when preparing the private root fails', async () => {
        const image = getUserPublicImagePaths('prepare-failure')
        await writeOwned(image.absoluteBackground, 'snapshot')
        await writeOwned(
            path.join(state.publicRoot, 'public-file'),
            'snapshot-public',
        )
        const source = await createSnapshot()
        await writeOwned(image.absoluteBackground, 'before')
        await writeOwned(
            path.join(state.publicRoot, 'public-file'),
            'before-public',
        )
        state.failPrivateOpenCount = 1
        await expect(restoreBackupArchive(source)).rejects.toThrow()
        expect(await actualFs.readFile(image.absoluteBackground, 'utf8')).toBe(
            'before',
        )
        expect(
            await actualFs.readFile(
                path.join(state.publicRoot, 'public-file'),
                'utf8',
            ),
        ).toBe('before-public')
        expect(restoreDump).not.toHaveBeenCalled()
    })

    it('retains rollback points and still rolls public storage back when the private rollback fails', async () => {
        const image = getUserPublicImagePaths('rollback-failure')
        await writeOwned(image.absoluteBackground, 'snapshot')
        await writeOwned(
            path.join(state.publicRoot, 'public-file'),
            'snapshot-public',
        )
        const source = await createSnapshot()
        await writeOwned(image.absoluteBackground, 'before')
        await writeOwned(
            path.join(state.publicRoot, 'public-file'),
            'before-public',
        )
        await expect(
            restoreBackupArchive({
                ...source,
                afterDatabaseRestore: async () => {
                    state.failPrivateOpenCount = 1
                    throw new Error('Synthetic callback failure')
                },
            }),
        ).rejects.toBeInstanceOf(RestoreRollbackError)
        expect(
            await actualFs.readFile(
                path.join(state.publicRoot, 'public-file'),
                'utf8',
            ),
        ).toBe('before-public')
        expect(
            (await actualFs.readdir(state.root)).some((name) =>
                name.startsWith('.storage-before-'),
            ),
        ).toBe(true)
        expect(
            (await actualFs.readdir(state.backupRoot)).some((name) =>
                name.startsWith('.restore-database-before-'),
            ),
        ).toBe(true)
    })

    it('does not delete a foreign replacement while rolling a newly added v2 file back', async () => {
        const source = await createHistoricalSnapshot(['newly-added'])
        const image = getUserPublicImagePaths('newly-added')
        await expect(
            restoreBackupArchive({
                ...source,
                afterDatabaseRestore: async () => {
                    await actualFs.rename(
                        image.absoluteBackground,
                        path.join(state.root, 'owned-displaced'),
                    )
                    await writeOwned(
                        image.absoluteBackground,
                        'foreign-replacement',
                    )
                    throw new Error('Synthetic later failure')
                },
            }),
        ).rejects.toBeInstanceOf(RestoreRollbackError)
        expect(await actualFs.readFile(image.absoluteBackground, 'utf8')).toBe(
            'foreign-replacement',
        )
    })

    it('reports failed private recovery cleanup after success without silently rolling applied data back', async () => {
        const image = getUserPublicImagePaths('cleanup-failure')
        await writeOwned(image.absoluteBackground, 'snapshot')
        const source = await createSnapshot()
        await writeOwned(image.absoluteBackground, 'before')
        state.failPrivateCleanup = true
        await expect(restoreBackupArchive(source)).rejects.toBeInstanceOf(
            RestoreRollbackError,
        )
        expect(await actualFs.readFile(image.absoluteBackground, 'utf8')).toBe(
            'snapshot',
        )
        expect(restoreDump).toHaveBeenCalledTimes(1)
        expect(
            (await actualFs.readdir(state.backupRoot)).some((name) =>
                name.startsWith('.restore-database-before-'),
            ),
        ).toBe(true)
    }, 20_000)

    it('rejects hardlinked private source images', async () => {
        const image = getUserPublicImagePaths('hardlink')
        await writeOwned(image.absoluteBackground, 'private')
        await actualFs.link(
            image.absoluteBackground,
            path.join(state.root, 'second-link'),
        )
        await expect(createSnapshot()).rejects.toThrow()
        expect(await actualFs.readdir(state.backupRoot)).toEqual([])
    })

    it('rejects overlapping public and private roots before destructive restore steps', async () => {
        const source = await createSnapshot()
        process.env.APP_PRIVATE_STORAGE_DIR = state.publicRoot
        createDump.mockClear()
        await expect(restoreBackupArchive(source)).rejects.toThrow()
        expect(createDump).not.toHaveBeenCalled()
        expect(restoreDump).not.toHaveBeenCalled()
    })

    it('rejects a junction alias of the public root as private storage', async () => {
        const alias = path.join(state.root, 'public-alias')
        await actualFs.symlink(
            state.publicRoot,
            alias,
            process.platform === 'win32' ? 'junction' : 'dir',
        )
        await expect(
            assertBackgroundStoragePathsService({
                storageRoot: state.publicRoot,
                privateStorageRoot: alias,
                protectedPaths: [state.backupRoot],
            }),
        ).rejects.toThrow()
    })

    it('keeps private metadata collection bounded and ignores unrelated private files', async () => {
        const image = getUserPublicImagePaths('managed')
        await writeOwned(image.absoluteBackground, 'managed')
        await writeOwned(
            path.join(state.privateRoot, 'unrelated-file'),
            'unrelated',
        )
        const entries = await collectBackgroundStorageFilesService({
            storageRoot: state.privateRoot,
            location: 'private',
        })
        expect(entries).toHaveLength(1)
        expect(entries[0]?.privateRelativePath).toBe(
            path.relative(state.privateRoot, image.absoluteBackground),
        )
        expect(getBackgroundStorageLayoutService().fileName).toBe(
            path.basename(image.absoluteBackground),
        )
    })

    it('delegates one combined capacity request for public and private filesystems', async () => {
        await actualFs.mkdir(state.privateRoot)
        await writeOwned(path.join(state.publicRoot, 'one'), '12345')
        await writeOwned(path.join(state.privateRoot, 'two'), '1234567')
        runCore.mockClear()
        await assertStorageRecoveryCapacityService([
            {
                directoryPath: state.publicRoot,
                sourcePaths: [state.publicRoot],
            },
            {
                directoryPath: state.privateRoot,
                sourcePaths: [state.privateRoot],
                additionalBytes: 11n,
            },
        ])
        expect(runCore.mock.calls).toHaveLength(1)
        expect(runCore.mock.calls[0]?.[1]).toMatchObject({
            operation: 'capacity',
            requests: [
                { directoryPath: state.publicRoot, additionalBytes: '0' },
                { directoryPath: state.privateRoot, additionalBytes: '11' },
            ],
        })
    })
    posixTest(
        'installs private background files and directories with POSIX modes 0600 and 0700',
        async () => {
            const source = await createHistoricalSnapshot(['permissions'])
            const image = getUserPublicImagePaths('permissions')
            await restoreBackupArchive(source)
            const file = await actualFs.lstat(image.absoluteBackground, {
                bigint: true,
            })
            const directory = await actualFs.lstat(
                image.absoluteBackgroundDir,
                { bigint: true },
            )
            expect(file.mode & 0o7777n).toBe(0o600n)
            expect(directory.mode & 0o7777n).toBe(0o700n)
        },
    )
    it('rolls back only newly inserted historical images and leaves prior private inodes untouched', async () => {
        const existing = getUserPublicImagePaths('old-private')
        const inserted = getUserPublicImagePaths('inserted-private')
        await writeOwned(existing.absoluteBackground, 'preserve-current')
        const before = await actualFs.lstat(existing.absoluteBackground, {
            bigint: true,
        })
        const source = await createHistoricalSnapshot([
            'old-private',
            'inserted-private',
        ])
        await expect(
            restoreBackupArchive({
                ...source,
                afterDatabaseRestore: async () => {
                    throw new Error('Synthetic later failure')
                },
            }),
        ).rejects.toThrow()
        const after = await actualFs.lstat(existing.absoluteBackground, {
            bigint: true,
        })
        expect(after.ino).toBe(before.ino)
        expect(after.mtimeNs).toBe(before.mtimeNs)
        expect(
            await actualFs.readFile(existing.absoluteBackground, 'utf8'),
        ).toBe('preserve-current')
        await expect(
            actualFs.lstat(inserted.absoluteBackground),
        ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('keeps a competing existing private file when a historical insertion loses exclusive creation', async () => {
        const source = await createHistoricalSnapshot(['collision'])
        state.collidePrivateOpenOnce = true
        await restoreBackupArchive(source)
        expect(
            await actualFs.readFile(
                getUserPublicImagePaths('collision').absoluteBackground,
                'utf8',
            ),
        ).toBe('synthetic-competing-file')
        expect(restoreDump).toHaveBeenCalledTimes(1)
    })

    it('does not enter an exchanged parent directory during historical rollback cleanup', async () => {
        const source = await createHistoricalSnapshot(['parent-replaced'])
        const image = getUserPublicImagePaths('parent-replaced')
        await expect(
            restoreBackupArchive({
                ...source,
                afterDatabaseRestore: async () => {
                    await actualFs.rename(
                        image.absoluteBackgroundDir,
                        path.join(state.root, 'displaced-parent'),
                    )
                    await writeOwned(
                        image.absoluteBackground,
                        'foreign-parent-file',
                    )
                    throw new Error('Synthetic callback failure')
                },
            }),
        ).rejects.toBeInstanceOf(RestoreRollbackError)
        expect(await actualFs.readFile(image.absoluteBackground, 'utf8')).toBe(
            'foreign-parent-file',
        )
    })

    it('fails safely on a symlinked private collection directory', async () => {
        const layout = getBackgroundStorageLayoutService()
        const linkedRoot = path.join(
            state.privateRoot,
            layout.privateRelativeDirectory,
        )
        const linkTarget = path.join(state.root, 'foreign-tree')
        await actualFs.mkdir(linkTarget, { recursive: true })
        await actualFs.mkdir(path.dirname(linkedRoot), { recursive: true })
        await actualFs.symlink(
            linkTarget,
            linkedRoot,
            process.platform === 'win32' ? 'junction' : 'dir',
        )
        await expect(createSnapshot()).rejects.toThrow()
        expect(await actualFs.readdir(state.backupRoot)).toEqual([])
    })
})
