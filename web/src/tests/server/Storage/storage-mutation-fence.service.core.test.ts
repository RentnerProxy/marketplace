import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
    chmod,
    lstat,
    link,
    mkdir,
    readFile,
    readdir,
    rename,
    rmdir,
    symlink,
    writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { STORAGE_MUTATION_BARRIER_CONFIG as config } from '@/config/storage-mutation-barrier.config.ts'
import {
    acquireExclusiveStorageMutationFenceService as acquireExclusive,
    admitSharedStorageMutationFenceService as admitShared,
    releaseStorageMutationFenceService as release,
    waitForStorageMutationSharedDrainService as drain,
} from '@/server/Storage/storage-mutation-fence.service.ts'
import {
    StorageMutationAdmissionBusyError,
    StorageMutationFenceUnavailableError,
} from '@/server/Storage/storage-mutation-fence.errors.ts'
import { preparePrivateStorageDirectoryService } from '@/server/Storage/private-files.service.ts'
import {
    cleanupStorageMutationTestDirectoryService,
    createStorageMutationTestDirectoryService,
} from './storageMutationFence.test.helpers.ts'
import type { StorageMutationTestDirectory } from './storageMutationFence.test.types.ts'

let fixture: StorageMutationTestDirectory

beforeEach(async function () {
    fixture = await createStorageMutationTestDirectoryService()
})

afterEach(async function () {
    await cleanupStorageMutationTestDirectoryService(fixture)
})

describe('persistent storage fence', function () {
    it('publishes bounded canonical private ownership and removes only its lease', async function () {
        const lease = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        const bytes = await readFile(lease.file.path)
        expect(bytes.length).toBeLessThanOrEqual(config.maxMetadataBytes)
        expect(JSON.parse(bytes.toString())).toEqual(lease.file.metadata)
        expect(lease.file.metadata.kind).toBe('shared')
        expect(lease.file.metadata.owner).toMatch(/^[0-9a-f-]{36}$/)
        expect((await lstat(lease.file.path, { bigint: true })).nlink).toBe(1n)
        expect(await readdir(fixture.rootDirectory)).toEqual(['shared'])
        await release(lease)
        expect(await readdir(lease.context.sharedDirectory)).toEqual([])
    })

    it('reuses the same owned lease only after new admission', async function () {
        const first = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        const second = await admitShared({
            rootDirectory: fixture.rootDirectory,
            currentLease: first,
        })
        expect(second).toBe(first)
        expect(await readdir(first.context.sharedDirectory)).toHaveLength(1)
        await release(first)
    })

    it('retains an exclusive marker while shared work drains outside the gate', async function () {
        const shared = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        const exclusive = await acquireExclusive({
            rootDirectory: fixture.rootDirectory,
            tryOnly: false,
        })
        expect(exclusive).not.toBeNull()
        if (!exclusive) throw new Error('Missing exclusive lease.')
        let drained = false
        const waiting = drain(exclusive).then(() => {
            drained = true
            return undefined
        })
        await expect(
            admitShared({ rootDirectory: fixture.rootDirectory }),
        ).rejects.toBeInstanceOf(StorageMutationAdmissionBusyError)
        expect(drained).toBe(false)
        await release(shared)
        await waiting
        expect(drained).toBe(true)
        await release(exclusive)
    })

    it('releases an existing shared lease even when the admission gate is occupied', async function () {
        const lease = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        await mkdir(
            path.join(fixture.rootDirectory, config.admissionDirectoryName),
            { mode: 0o700 },
        )
        await release(lease)
        expect(await readdir(lease.context.sharedDirectory)).toEqual([])
        expect(
            (
                await lstat(
                    path.join(
                        fixture.rootDirectory,
                        config.admissionDirectoryName,
                    ),
                )
            ).isDirectory(),
        ).toBe(true)
    })

    it('admits at most one exclusive candidate', async function () {
        const outcomes = await Promise.allSettled([
            acquireExclusive({
                rootDirectory: fixture.rootDirectory,
                tryOnly: false,
            }),
            acquireExclusive({
                rootDirectory: fixture.rootDirectory,
                tryOnly: false,
            }),
        ])
        const winners = outcomes.flatMap((result) =>
            result.status === 'fulfilled' && result.value ? [result.value] : [],
        )
        expect(winners).toHaveLength(1)
        expect(
            outcomes.filter((result) => result.status === 'rejected'),
        ).toHaveLength(1)
        await release(winners[0]!)
    })

    it('returns busy without overwriting a foreign exclusive owner', async function () {
        const owner = await acquireExclusive({
            rootDirectory: fixture.rootDirectory,
            tryOnly: false,
        })
        if (!owner) throw new Error('Missing owner.')
        const before = await readFile(owner.file.path)
        expect(
            await acquireExclusive({
                rootDirectory: fixture.rootDirectory,
                tryOnly: true,
            }),
        ).toBeNull()
        expect(await readFile(owner.file.path)).toEqual(before)
        await release(owner)
    })

    it('keeps a crash gate without a time based takeover', async function () {
        await preparePrivateStorageDirectoryService(
            fixture.rootDirectory,
            fixture.rootDirectory,
        )
        const gate = path.join(
            fixture.rootDirectory,
            config.admissionDirectoryName,
        )
        await mkdir(gate, { mode: 0o700 })
        expect(
            await acquireExclusive({
                rootDirectory: fixture.rootDirectory,
                tryOnly: true,
            }),
        ).toBeNull()
        expect(await readdir(gate)).toEqual([])
    })

    it('does not publish an exclusive marker for an unsuccessful try against shared work', async function () {
        const shared = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        expect(
            await acquireExclusive({
                rootDirectory: fixture.rootDirectory,
                tryOnly: true,
            }),
        ).toBeNull()
        expect(await readdir(fixture.rootDirectory)).toEqual(['shared'])
        await release(shared)
    })

    it.each([
        '{}',
        JSON.stringify({
            version: 2,
            kind: 'exclusive',
            owner: '00000000-0000-4000-8000-000000000001',
        }),
        JSON.stringify({
            version: 1,
            kind: 'shared',
            owner: '00000000-0000-4000-8000-000000000001',
        }),
        JSON.stringify({ version: 1, kind: 'exclusive', owner: 'invalid' }),
        'x'.repeat(config.maxMetadataBytes + 1),
    ])('fails closed for invalid foreign metadata', async function (value) {
        await preparePrivateStorageDirectoryService(
            fixture.rootDirectory,
            fixture.rootDirectory,
        )
        const marker = path.join(
            fixture.rootDirectory,
            config.exclusiveFileName,
        )
        await writeFile(marker, value, { mode: 0o600 })
        await expect(
            admitShared({ rootDirectory: fixture.rootDirectory }),
        ).rejects.toBeInstanceOf(StorageMutationFenceUnavailableError)
        expect(await readFile(marker, 'utf8')).toBe(value)
    })

    it('never removes a hardlinked control file', async function () {
        const lease = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        const secondName = path.join(fixture.temporaryDirectory, 'foreign-link')
        await link(lease.file.path, secondName)
        await expect(release(lease)).rejects.toBeInstanceOf(
            StorageMutationFenceUnavailableError,
        )
        expect((await lstat(secondName, { bigint: true })).nlink).toBe(2n)
    })

    it('never removes a replacement inode with copied ownership metadata', async function () {
        const lease = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        const bytes = await readFile(lease.file.path)
        await rename(
            lease.file.path,
            path.join(fixture.temporaryDirectory, 'original-lease'),
        )
        await writeFile(lease.file.path, bytes, { mode: 0o600 })
        await expect(release(lease)).rejects.toBeInstanceOf(
            StorageMutationFenceUnavailableError,
        )
        expect(await readFile(lease.file.path)).toEqual(bytes)
    })

    it('never removes altered metadata from its original inode', async function () {
        const lease = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        const value = JSON.stringify({ ...lease.file.metadata, extra: true })
        await writeFile(lease.file.path, value)
        await expect(release(lease)).rejects.toBeInstanceOf(
            StorageMutationFenceUnavailableError,
        )
        expect(await readFile(lease.file.path, 'utf8')).toBe(value)
    })

    it('rejects a replaced shared directory without touching its target', async function () {
        const lease = await admitShared({
            rootDirectory: fixture.rootDirectory,
        })
        await release(lease)
        const victim = path.join(fixture.temporaryDirectory, 'unrelated')
        await mkdir(victim)
        await writeFile(path.join(victim, 'sentinel'), 'preserve')
        await rmdir(lease.context.sharedDirectory)
        await symlink(
            victim,
            lease.context.sharedDirectory,
            process.platform === 'win32' ? 'junction' : 'dir',
        )
        await expect(
            admitShared({ rootDirectory: fixture.rootDirectory }),
        ).rejects.toBeInstanceOf(StorageMutationFenceUnavailableError)
        expect(await readFile(path.join(victim, 'sentinel'), 'utf8')).toBe(
            'preserve',
        )
    })

    it.skipIf(process.platform === 'win32')(
        'enforces actual POSIX directory and file modes',
        async function () {
            const lease = await admitShared({
                rootDirectory: fixture.rootDirectory,
            })
            expect((await lstat(fixture.rootDirectory)).mode & 0o7777).toBe(
                0o700,
            )
            expect(
                (await lstat(lease.context.sharedDirectory)).mode & 0o7777,
            ).toBe(0o700)
            expect((await lstat(lease.file.path)).mode & 0o7777).toBe(0o600)
            await chmod(lease.file.path, 0o644)
            await expect(release(lease)).rejects.toBeInstanceOf(
                StorageMutationFenceUnavailableError,
            )
        },
    )
})
