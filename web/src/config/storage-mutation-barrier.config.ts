export const STORAGE_MUTATION_BARRIER_CONFIG = {
    sqlKey: 'rentnerproxy-marketplace:storage:mutation-barrier',
    directoryName: '.storage-mutation-barrier-v1',
    sharedDirectoryName: 'shared',
    exclusiveFileName: 'exclusive.json',
    version: 1,
    maxErrorNodes: 64,
    admissionWaitMs: 1_000,
    admissionPollMs: 25,
    sharedIdleHoldMs: 1_500,
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
