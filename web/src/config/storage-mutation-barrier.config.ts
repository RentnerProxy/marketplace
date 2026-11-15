export const STORAGE_MUTATION_BARRIER_CONFIG = {
    sqlKey: 'rentnerproxy-marketplace:storage:mutation-barrier',
    directoryName: '.storage-mutation-barrier-v1',
    admissionDirectoryName: 'admission',
    sharedDirectoryName: 'shared',
    ownerFileName: 'owner.json',
    exclusiveFileName: 'exclusive.json',
    version: 1,
    maxMetadataBytes: 256,
    maxScanEntries: 1024,
    maxErrorNodes: 64,
    admissionWaitMs: 1_000,
    admissionPollMs: 25,
    drainPollMs: 50,
    sqlEvents: {
        shared: {
            unlockFailed: 'storage.mutation_barrier.shared_unlock_failed',
            unlockUnconfirmed:
                'storage.mutation_barrier.shared_unlock_unconfirmed',
            discardFailed:
                'storage.mutation_barrier.shared_unlock_connection_discard_failed',
        },
        exclusive: {
            unlockFailed: 'storage.mutation_barrier.exclusive_unlock_failed',
            unlockUnconfirmed:
                'storage.mutation_barrier.exclusive_unlock_unconfirmed',
            discardFailed:
                'storage.mutation_barrier.exclusive_connection_discard_failed',
        },
        exclusive_try: {
            unlockFailed:
                'storage.mutation_barrier.exclusive_try_unlock_failed',
            unlockUnconfirmed:
                'storage.mutation_barrier.exclusive_try_unlock_unconfirmed',
            discardFailed:
                'storage.mutation_barrier.exclusive_try_connection_discard_failed',
        },
    },
} as const
