import type { ReservedSQL } from 'bun'
import { setTimeout as wait } from 'node:timers/promises'
import { db } from '@/db'
import { STORAGE_MUTATION_BARRIER_CONFIG as config } from '@/config/storage-mutation-barrier.config.ts'
import { getBackupFilePath } from '@/server/Admin/Backups/backup-directory.service.ts'
import { isRestoreStateActiveService } from '@/server/Admin/Backups/restore-state.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { hasUncertainStorageMutationFailureService } from './storage-mutation-failure.service.ts'
import {
    isStorageMutationBarrierHealthyService,
    markStorageMutationBarrierUnhealthyService,
} from './storage-mutation-barrier-health.service.ts'
import {
    acquireExclusiveStorageMutationFenceService,
    admitSharedStorageMutationFenceService,
    releaseStorageMutationFenceService,
    waitForStorageMutationSharedDrainService,
} from './storage-mutation-fence.service.ts'
import {
    StorageMutationAdmissionBusyError,
    StorageMutationFenceUnavailableError,
} from './storage-mutation-fence.errors.ts'
import {
    getActiveStorageMutationScopeService,
    runInStorageMutationScopeService,
} from './storage-mutation-scope.service.ts'
import type {
    SharedStorageMutationLease,
    StorageMutationOperationOutcome,
    StorageMutationSqlAcquireRow,
    StorageMutationSqlKind,
    StorageMutationSqlLockState,
    StorageMutationSqlUnlockRow,
    StorageMutationTryResult,
} from './Types/storage-mutation-barrier.types.ts'
import type { StorageMutationScopeLease } from './Types/storage-mutation-scope.types.ts'

let sharedLease: SharedStorageMutationLease | null = null
let stateTransition = Promise.resolve()

export class StorageMutationBarrierUnavailableError extends Error {
    constructor() {
        super(
            'Der Storage-Mutations-Lock ist nicht bestätigt. Der Betreiber muss laufende Prozesse und den persistenten Wiederherstellungszustand prüfen.',
        )
        this.name = 'StorageMutationBarrierUnavailableError'
    }
}

export class RestoreInProgressError extends Error {
    constructor() {
        super('Das System wird gerade aus einem Backup wiederhergestellt.')
        this.name = 'RestoreInProgressError'
    }
}

function unavailable(error: unknown): never {
    const failure = new StorageMutationBarrierUnavailableError()
    markStorageMutationBarrierUnhealthyService(error)
    throw failure
}

function assertHealthy() {
    if (!isStorageMutationBarrierHealthyService())
        throw new StorageMutationBarrierUnavailableError()
}

function throwMappedFenceError(error: unknown): never {
    if (error instanceof StorageMutationAdmissionBusyError)
        throw new RestoreInProgressError()
    if (error instanceof StorageMutationFenceUnavailableError)
        return unavailable(error)
    throw error
}

async function discardReservedConnection(
    connection: ReservedSQL,
    eventName: string,
    primaryError?: unknown,
): Promise<void> {
    try {
        await connection.close({ timeout: 0 })
    } catch (error) {
        markStorageMutationBarrierUnhealthyService(error)
        logError(eventName, error)
        if (primaryError !== undefined)
            throw new AggregateError(
                [primaryError, error],
                'Der Storage-Lock und seine Verbindung konnten nicht sicher freigegeben werden.',
                { cause: error },
            )
        throw error
    }
}

async function releaseSqlBarrier(
    connection: ReservedSQL,
    kind: StorageMutationSqlKind,
    state: StorageMutationSqlLockState,
    primaryError?: unknown,
): Promise<void> {
    const events = config.sqlEvents[kind]
    if (state === 'not-acquired') {
        try {
            await connection.release()
            return
        } catch (error) {
            await discardReservedConnection(
                connection,
                events.discardFailed,
                error,
            )
            return
        }
    }
    if (state === 'locked') {
        try {
            const rows =
                kind === 'shared'
                    ? await connection<Array<StorageMutationSqlUnlockRow>>`
                        select pg_catalog.pg_advisory_unlock_shared(
                            pg_catalog.hashtext(${config.sqlKey})
                        ) as unlocked
                    `
                    : await connection<Array<StorageMutationSqlUnlockRow>>`
                        select pg_catalog.pg_advisory_unlock(
                            pg_catalog.hashtext(${config.sqlKey})
                        ) as unlocked
                    `
            if (rows.length === 1 && rows.at(0)?.unlocked === true) {
                await connection.release()
                return
            }
            const error = new Error('Storage SQL unlock was not confirmed.')
            logError(events.unlockUnconfirmed, error)
            primaryError ??= error
        } catch (error) {
            logError(events.unlockFailed, error)
            primaryError ??= error
        }
    }
    await discardReservedConnection(
        connection,
        events.discardFailed,
        primaryError,
    )
}

function runStateTransition<TResult>(
    operation: () => TResult | Promise<TResult>,
): Promise<TResult> {
    const result = stateTransition.then(operation)
    stateTransition = result.then(
        () => undefined,
        () => undefined,
    )
    return result
}

async function acquireSharedBarrier(
    deadline = performance.now() + config.admissionWaitMs,
): Promise<SharedStorageMutationLease> {
    try {
        assertHealthy()
        if (await isRestoreStateActiveService())
            throw new RestoreInProgressError()
        const rootDirectory = await getBackupFilePath(config.directoryName)
        return await runStateTransition(async function () {
            assertHealthy()
            const fence = await admitSharedStorageMutationFenceService({
                rootDirectory,
                currentLease: sharedLease?.fence,
            })
            if (sharedLease) {
                sharedLease.activeOperations += 1
                return sharedLease
            }
            let connection: ReservedSQL | null = null
            let state: StorageMutationSqlLockState = 'unconfirmed'
            try {
                connection = await db.$client.reserve()
                const rows = await connection<
                    Array<StorageMutationSqlAcquireRow>
                >`
                    select pg_catalog.pg_try_advisory_lock_shared(
                        pg_catalog.hashtext(${config.sqlKey})
                    ) as acquired
                `
                if (
                    rows.length !== 1 ||
                    typeof rows.at(0)?.acquired !== 'boolean'
                )
                    throw new Error('Storage SQL admission was not confirmed.')
                if (rows.at(0)?.acquired !== true) {
                    state = 'not-acquired'
                    throw new RestoreInProgressError()
                }
                state = 'locked'
                sharedLease = {
                    connection,
                    fence,
                    scopeLease: {
                        kind: 'shared',
                        active: true,
                        uncertain: false,
                    },
                    activeOperations: 1,
                }
                return sharedLease
            } catch (error) {
                if (connection)
                    await releaseSqlBarrier(connection, 'shared', state, error)
                await releaseStorageMutationFenceService(fence)
                throw error
            }
        })
    } catch (error) {
        if (
            error instanceof StorageMutationAdmissionBusyError &&
            performance.now() < deadline
        ) {
            await wait(config.admissionPollMs)
            return acquireSharedBarrier(deadline)
        }
        return throwMappedFenceError(error)
    }
}

async function releaseSharedBarrier(
    lease: SharedStorageMutationLease,
    primaryError?: unknown,
): Promise<void> {
    try {
        await runStateTransition(async function () {
            if (sharedLease !== lease || lease.activeOperations <= 0)
                unavailable(new Error('Storage lease accounting failed.'))
            lease.activeOperations -= 1
            if (lease.activeOperations > 0) return
            sharedLease = null
            lease.scopeLease.active = false
            await releaseSqlBarrier(
                lease.connection,
                'shared',
                'locked',
                primaryError,
            )
            if (lease.scopeLease.uncertain)
                unavailable(
                    new Error('Storage operation cleanup was not confirmed.'),
                )
            await releaseStorageMutationFenceService(lease.fence)
        })
    } catch (error) {
        throwMappedFenceError(error)
    }
}

export async function withSharedStorageMutationBarrier<TResult>(
    operation: () => TResult | Promise<TResult>,
): Promise<TResult> {
    const inherited = getActiveStorageMutationScopeService()
    if (inherited)
        return runInStorageMutationScopeService(inherited.lease, operation)
    const lease = await acquireSharedBarrier()
    let primaryError: unknown
    try {
        return await runInStorageMutationScopeService(
            lease.scopeLease,
            operation,
        )
    } catch (error) {
        primaryError = error
        throw error
    } finally {
        await releaseSharedBarrier(lease, primaryError)
    }
}

async function runExclusiveBarrier<TResult>(
    operation: () => TResult | Promise<TResult>,
    tryOnly: boolean,
): Promise<StorageMutationTryResult<TResult>> {
    assertHealthy()
    if (getActiveStorageMutationScopeService()) {
        if (tryOnly) return { acquired: false }
        throw new RestoreInProgressError()
    }
    const kind = tryOnly ? 'exclusive_try' : 'exclusive'
    const scopeLease: StorageMutationScopeLease = {
        kind: 'exclusive',
        active: true,
        uncertain: false,
    }
    let connection: ReservedSQL | null = null
    let state: StorageMutationSqlLockState = 'unconfirmed'
    let callbackStarted = false
    let outcome: StorageMutationOperationOutcome<
        StorageMutationTryResult<TResult>
    >
    const rootDirectory = await getBackupFilePath(config.directoryName)
    const fence = await acquireExclusiveStorageMutationFenceService({
        rootDirectory,
        tryOnly,
    })
    if (!fence) return { acquired: false }

    try {
        await waitForStorageMutationSharedDrainService(fence)
        connection = await db.$client.reserve()
        if (tryOnly) {
            const rows = await connection<Array<StorageMutationSqlAcquireRow>>`
                select pg_catalog.pg_try_advisory_lock(
                    pg_catalog.hashtext(${config.sqlKey})
                ) as acquired
            `
            if (rows.length !== 1 || typeof rows.at(0)?.acquired !== 'boolean')
                throw new Error('Storage SQL admission was not confirmed.')
            if (rows.at(0)?.acquired !== true) {
                state = 'not-acquired'
                outcome = { ok: true, value: { acquired: false } }
            } else {
                state = 'locked'
                callbackStarted = true
                outcome = {
                    ok: true,
                    value: {
                        acquired: true,
                        result: await runInStorageMutationScopeService(
                            scopeLease,
                            operation,
                        ),
                    },
                }
            }
        } else {
            await connection`
                select pg_catalog.pg_advisory_lock(
                    pg_catalog.hashtext(${config.sqlKey})
                )
            `
            state = 'locked'
            callbackStarted = true
            outcome = {
                ok: true,
                value: {
                    acquired: true,
                    result: await runInStorageMutationScopeService(
                        scopeLease,
                        operation,
                    ),
                },
            }
        }
    } catch (error) {
        outcome = { ok: false, error }
    }
    scopeLease.active = false
    const primaryError = outcome.ok ? undefined : outcome.error
    if (connection)
        await releaseSqlBarrier(connection, kind, state, primaryError)
    const retain =
        scopeLease.uncertain ||
        primaryError instanceof StorageMutationFenceUnavailableError ||
        (callbackStarted &&
            (hasUncertainStorageMutationFailureService(primaryError) ||
                (await isRestoreStateActiveService())))
    if (retain) {
        const error = new StorageMutationBarrierUnavailableError()
        markStorageMutationBarrierUnhealthyService(error)
        if (!outcome.ok) throw outcome.error
        throw error
    }
    await releaseStorageMutationFenceService(fence)
    if (!outcome.ok) throw outcome.error
    return outcome.value
}

export async function withExclusiveStorageMutationBarrier<TResult>(
    operation: () => TResult | Promise<TResult>,
): Promise<TResult> {
    try {
        const result = await runExclusiveBarrier(operation, false)
        if (!result.acquired) throw new RestoreInProgressError()
        return result.result
    } catch (error) {
        return throwMappedFenceError(error)
    }
}

export async function tryWithExclusiveStorageMutationBarrier<TResult>(
    operation: () => TResult | Promise<TResult>,
): Promise<StorageMutationTryResult<TResult>> {
    try {
        return await runExclusiveBarrier(operation, true)
    } catch (error) {
        return throwMappedFenceError(error)
    }
}
