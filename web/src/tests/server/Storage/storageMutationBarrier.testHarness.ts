import type { StorageMutationFenceLease } from '@/server/Storage/Types/storage-mutation-fence.types.ts'
import { vi } from 'bun:test'

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
        rootDirectory: '/synthetic-storage-fence',
        sharedDirectory: '/synthetic-storage-fence/shared',
        directories: [],
    },
    file: {
        path: '/synthetic-storage-fence/shared/owned.json',
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

vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupFilePath: vi.fn(async () => '/synthetic-storage-fence'),
}))
vi.mock('@/server/Storage/storage-mutation-fence.service.ts', () => ({
    admitSharedStorageMutationFenceService: vi.fn(async () => sharedFence),
    acquireExclusiveStorageMutationFenceService: vi.fn(
        async () => exclusiveFence,
    ),
    releaseStorageMutationFenceService: vi.fn(async () => undefined),
    waitForStorageMutationSharedDrainService: vi.fn(async () => undefined),
}))
