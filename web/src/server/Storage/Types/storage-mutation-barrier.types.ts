import type { ReservedSQL } from 'bun'
import type { FSWatcher } from 'node:fs'
import type { StorageMutationFenceLease } from './storage-mutation-fence.types.ts'
import type { StorageMutationScopeLease } from './storage-mutation-scope.types.ts'

export type StorageMutationSqlLockState =
    'unconfirmed' | 'not-acquired' | 'locked'
export type StorageMutationSqlKind = 'shared' | 'exclusive' | 'exclusive_try'
export type StorageMutationSqlAcquireRow = { acquired: boolean }
export type StorageMutationSqlUnlockRow = { unlocked: boolean }

export type SharedStorageMutationLease = {
    connection: ReservedSQL
    fence: StorageMutationFenceLease
    scopeLease: StorageMutationScopeLease
    activeOperations: number
    idleTimer?: ReturnType<typeof setTimeout>
    exclusiveWatcher?: FSWatcher
    releaseRequested?: boolean
    drainCompletion?: PromiseWithResolvers<void>
}

export type StorageMutationTryResult<TResult> =
    { acquired: false } | { acquired: true; result: TResult }

export type StorageMutationOperationOutcome<TResult> =
    { ok: true; value: TResult } | { ok: false; error: unknown }
