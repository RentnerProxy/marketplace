import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
    StorageMutationFenceLease,
    StorageMutationSharedFenceInput,
} from '@/server/Storage/Types/storage-mutation-fence.types.ts'
import { afterAll, vi } from 'bun:test'

export const fenceRoot = await mkdtemp(path.join(tmpdir(), 'storage-mutation-'))
afterAll(() => rm(fenceRoot, { recursive: true, force: true }))

export const barrierMocks = (function () {
    const events: string[] = []
    const failures = {
        acquireExclusive: false,
        acquireShared: false,
        closeConnection: false,
        unlockExclusive: false,
        unlockExclusiveUnconfirmed: false,
        unlockShared: false,
        unlockSharedUnconfirmed: false,
        tryExclusiveUnavailable: false,
    }
    const isRestoreActive = vi.fn(async function () {
        return false
    })
    const release = vi.fn(function () {
        events.push('connection:release')
    })
    const close = vi.fn(async function () {
        events.push('connection:close')

        if (failures.closeConnection) {
            throw new Error('connection close failed')
        }
    })
    const connection = Object.assign(
        vi.fn(async function (strings: TemplateStringsArray) {
            const query = strings.join('?').replace(/\s+/g, ' ').trim()
            events.push(`query:${query}`)

            if (query.includes('pg_try_advisory_lock_shared')) {
                if (failures.acquireShared) {
                    throw new Error('shared acquire failed')
                }
                return [{ acquired: true }]
            }

            if (query.includes('pg_advisory_unlock_shared')) {
                if (failures.unlockShared) {
                    throw new Error('shared unlock failed')
                }
                return [{ unlocked: !failures.unlockSharedUnconfirmed }]
            }

            if (query.includes('pg_try_advisory_lock')) {
                return [{ acquired: !failures.tryExclusiveUnavailable }]
            }

            if (query.includes('pg_advisory_lock')) {
                if (failures.acquireExclusive) {
                    throw new Error('exclusive acquire failed')
                }
                return []
            }

            if (query.includes('pg_advisory_unlock')) {
                if (failures.unlockExclusive) {
                    throw new Error('exclusive unlock failed')
                }
                return [{ unlocked: !failures.unlockExclusiveUnconfirmed }]
            }

            return []
        }),
        { close, release },
    )
    const reserve = vi.fn(async function () {
        events.push('connection:reserve')
        return connection
    })

    return {
        close,
        connection,
        events,
        failures,
        isRestoreActive,
        release,
        reserve,
    }
})()

vi.mock('@/db', function () {
    return { db: { $client: { reserve: barrierMocks.reserve } } }
})

vi.mock('@/server/Admin/Backups/restore-state.service.ts', function () {
    return { isRestoreStateActiveService: barrierMocks.isRestoreActive }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn(), logInfo: vi.fn() }
})

export function resetStorageMutationBarrierTestHarness() {
    vi.clearAllMocks()
    barrierMocks.events.length = 0
    barrierMocks.isRestoreActive.mockResolvedValue(false)
    barrierMocks.failures.acquireExclusive = false
    barrierMocks.failures.acquireShared = false
    barrierMocks.failures.closeConnection = false
    barrierMocks.failures.unlockExclusive = false
    barrierMocks.failures.unlockExclusiveUnconfirmed = false
    barrierMocks.failures.unlockShared = false
    barrierMocks.failures.unlockSharedUnconfirmed = false
    barrierMocks.failures.tryExclusiveUnavailable = false
}

const sharedFence: StorageMutationFenceLease = {
    context: {
        rootDirectory: fenceRoot,
        sharedDirectory: path.join(fenceRoot, 'shared'),
        directories: [],
    },
    file: {
        path: path.join(fenceRoot, 'shared', 'owned.json'),
        identity: { dev: 1n, ino: 1n },
        metadata: {
            version: 1,
            kind: 'shared',
            owner: '00000000-0000-4000-8000-000000000001',
        },
    },
}
const exclusiveFence: StorageMutationFenceLease = {
    ...sharedFence,
    file: {
        ...sharedFence.file,
        metadata: { ...sharedFence.file.metadata, kind: 'exclusive' },
    },
}

export const fenceMocks = {
    prepareRoot: vi.fn(async () => fenceRoot),
    backupPaths: vi.fn(() => ({
        backupDirectory: '/synthetic-backups',
        storageDirectory: '/synthetic-storage',
    })),
    acquireExclusive: vi.fn(async () => exclusiveFence),
    admitShared: vi.fn(
        async (_input: StorageMutationSharedFenceInput) => sharedFence,
    ),
    release: vi.fn(async (): Promise<void> => undefined),
}

vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupFilePath: fenceMocks.prepareRoot,
    getBackupStoragePaths: fenceMocks.backupPaths,
}))
vi.mock('@/server/Storage/storage-mutation-fence.service.ts', () => ({
    admitSharedStorageMutationFenceService: fenceMocks.admitShared,
    acquireExclusiveStorageMutationFenceService: fenceMocks.acquireExclusive,
    releaseStorageMutationFenceService: fenceMocks.release,
    waitForStorageMutationSharedDrainService: vi.fn(async () => undefined),
}))
