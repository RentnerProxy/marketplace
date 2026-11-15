import type { RestoreState } from '@/server/Admin/Backups/Types/restore-state.types.ts'
import { mailRestoreQuiescenceSchema } from '@/server/Queues/mail-restore-quiescence.schema.ts'
import type {
    MailRestoreQuiescence,
    RestoreObservation,
    StoredQuiescence,
    MailRestoreQuiescenceOptions,
    CompleteRestoreQuiescence,
} from '@/server/Queues/Types/mail-restore-quiescence.types.ts'
import { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'

import {
    getBullMqProducerConnectionOptions,
    getValkeyConnection,
} from '@/server/Valkey/valkey.service.ts'
import {
    getRestoreStateService,
    writeRestoreStateService,
} from '@/server/Admin/Backups/restore-state.service.ts'
import { logError, logInfo } from '@/server/Logging/logger.ts'
import { tryWithExclusiveStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'

const MAIL_RESTORE_QUIESCENCE_KEY =
    'rentnerproxy-marketplace:mail:restore-quiescence:v1'
const DEFAULT_ACTIVE_DRAIN_TIMEOUT_MS = 60_000
const DEFAULT_ACTIVE_DRAIN_POLL_INTERVAL_MS = 100
const DEFAULT_OWNER_LEASE_MS = 2 * 60_000

const replaceOwnedQuiescenceScript = `
if server.call('get', KEYS[1]) == ARGV[1] then
    server.call('set', KEYS[1], ARGV[2])
    return 1
end
return 0
`

const deleteOwnedQuiescenceScript = `
if server.call('get', KEYS[1]) == ARGV[1] then
    return server.call('del', KEYS[1])
end
return 0
`

const confirmEmptyQuiescenceScript = `
if server.call('get', KEYS[1]) ~= ARGV[1] then
    return -1
end
for index = 2, #KEYS, 6 do
    for offset = 0, 2 do
        if server.call('LLEN', KEYS[index + offset]) ~= 0 then
            return 0
        end
    end
    for offset = 3, 5 do
        if server.call('ZCARD', KEYS[index + offset]) ~= 0 then
            return 0
        end
    end
end
server.call('set', KEYS[1], ARGV[2])
return 1
`

function validatePositiveInteger(value: number, description: string) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${description} ist ungültig.`)
    }
}

function getRestoreIdentity(state: RestoreState | null) {
    if (!state) {
        return null
    }

    return {
        startedAt: state.startedAt,
        status: state.status,
        updatedAt: state.updatedAt,
    }
}

function getRestoreBaseline(
    observation: RestoreObservation,
): MailRestoreQuiescence['restoreBaseline'] {
    if (observation.kind === 'unknown') {
        return { kind: 'unknown' }
    }

    return {
        kind: 'known',
        state: getRestoreIdentity(observation.state),
    }
}

function isRestoreActive(observation: RestoreObservation) {
    if (observation.kind === 'unknown') {
        return true
    }

    return (
        observation.state?.status === 'running' ||
        observation.state?.status === 'recovery-required'
    )
}

function isNewCompletedRestore(
    observation: RestoreObservation,
    baseline: MailRestoreQuiescence['restoreBaseline'],
) {
    if (
        observation.kind === 'unknown' ||
        observation.state?.status !== 'completed' ||
        baseline.kind === 'unknown'
    ) {
        return false
    }

    const currentIdentity = getRestoreIdentity(observation.state)

    return (
        currentIdentity?.startedAt !== baseline.state?.startedAt ||
        currentIdentity?.status !== baseline.state?.status ||
        currentIdentity?.updatedAt !== baseline.state?.updatedAt
    )
}

async function observeRestoreState(): Promise<RestoreObservation> {
    try {
        return {
            kind: 'known',
            state: await getRestoreStateService(),
        }
    } catch {
        return { kind: 'unknown' }
    }
}

function assertQueueContract(
    record: MailRestoreQuiescence,
    queueNames: ReadonlyArray<string>,
) {
    const storedNames = record.queues.map((queue) => queue.name)

    if (
        new Set(storedNames).size !== storedNames.length ||
        storedNames.length !== queueNames.length ||
        queueNames.some((name) => !storedNames.includes(name))
    ) {
        throw new Error(
            'Der gespeicherte Mail-Quiesce passt nicht zu den konfigurierten Queues.',
        )
    }
}

function getStoredQueueState(record: MailRestoreQuiescence, queueName: string) {
    const queueState = record.queues.find(
        (candidate) => candidate.name === queueName,
    )

    if (!queueState) {
        throw new Error('Der Mail-Queue-Zustand ist unvollständig.')
    }

    return queueState
}

async function getPausedJobIds(queue: Queue) {
    const client = await queue.getBackend().client
    const [waitingIds, pausedIds] = await Promise.all([
        client.lrange(queue.toKey('wait'), 0, -1),
        client.lrange(queue.toKey('paused'), 0, -1),
    ])

    return [...waitingIds, ...pausedIds].filter(
        (jobId) => !jobId.startsWith('0:'),
    )
}

export function createMailRestoreQuiescenceService(
    input: MailRestoreQuiescenceOptions,
) {
    if (
        input.queueNames.length === 0 ||
        new Set(input.queueNames).size !== input.queueNames.length
    ) {
        throw new Error('Die Mail-Queue-Liste ist ungültig.')
    }

    const activeDrainTimeoutMs =
        input.activeDrainTimeoutMs ?? DEFAULT_ACTIVE_DRAIN_TIMEOUT_MS
    const activeDrainPollIntervalMs =
        input.activeDrainPollIntervalMs ?? DEFAULT_ACTIVE_DRAIN_POLL_INTERVAL_MS
    const ownerLeaseMs = input.ownerLeaseMs ?? DEFAULT_OWNER_LEASE_MS
    validatePositiveInteger(activeDrainTimeoutMs, 'Das Mail-Drain-Zeitlimit')
    validatePositiveInteger(
        activeDrainPollIntervalMs,
        'Das Mail-Drain-Pollingintervall',
    )
    validatePositiveInteger(ownerLeaseMs, 'Die Mail-Quiesce-Lease')

    const queueNames = [...input.queueNames]
    const queues = queueNames.map(
        (name) =>
            new Queue(name, {
                connection: getBullMqProducerConnectionOptions(),
            }),
    )
    const valkey = getValkeyConnection()
    let valkeyRecoveryStarted = false
    let valkeyRecoveryPromise = Promise.resolve()
    let ownerLeaseRecoveryTimer: ReturnType<typeof setTimeout> | undefined

    async function loadStoredQuiescence() {
        const serialized = await valkey.get(MAIL_RESTORE_QUIESCENCE_KEY)

        if (!serialized) {
            return null
        }

        let inputValue: unknown

        try {
            inputValue = JSON.parse(serialized)
        } catch {
            throw new Error('Der gespeicherte Mail-Quiesce ist beschädigt.')
        }

        const parsed = mailRestoreQuiescenceSchema.safeParse(inputValue)

        if (!parsed.success) {
            throw new Error(
                'Der gespeicherte Mail-Quiesce ist ungültig oder nicht unterstützt.',
            )
        }

        assertQueueContract(parsed.data, queueNames)
        return { record: parsed.data, serialized }
    }

    async function createStoredQuiescence(record: MailRestoreQuiescence) {
        const serialized = JSON.stringify(record)
        const result = await valkey.set(
            MAIL_RESTORE_QUIESCENCE_KEY,
            serialized,
            'NX',
        )

        return result === 'OK' ? { record, serialized } : null
    }

    async function replaceStoredQuiescence(
        stored: StoredQuiescence,
        record: MailRestoreQuiescence,
    ) {
        const serialized = JSON.stringify(record)
        const replaced = await valkey.eval(
            replaceOwnedQuiescenceScript,
            1,
            MAIL_RESTORE_QUIESCENCE_KEY,
            stored.serialized,
            serialized,
        )

        if (replaced !== 1) {
            throw new Error(
                'Der globale Mail-Quiesce wurde parallel verändert.',
            )
        }

        return { record, serialized }
    }

    async function deleteStoredQuiescence(stored: StoredQuiescence) {
        const deleted = await valkey.eval(
            deleteOwnedQuiescenceScript,
            1,
            MAIL_RESTORE_QUIESCENCE_KEY,
            stored.serialized,
        )

        if (deleted !== 1) {
            throw new Error(
                'Der globale Mail-Quiesce wurde parallel verändert.',
            )
        }
    }

    async function pauseQueues() {
        await Promise.all(queues.map((queue) => queue.pause()))
    }

    async function waitForActiveJobs() {
        const deadline = Date.now() + activeDrainTimeoutMs

        async function checkActiveJobs(): Promise<void> {
            const counts = await Promise.all(
                queues.map((queue) => queue.getJobCounts('active')),
            )
            const activeCount = counts.reduce(
                (sum, queueCounts) => sum + (queueCounts.active ?? 0),
                0,
            )

            if (activeCount === 0) {
                return
            }

            if (Date.now() >= deadline) {
                throw new Error(
                    'Aktive Mail-Jobs wurden nicht innerhalb des Zeitlimits beendet.',
                )
            }

            await wait(
                Math.min(
                    activeDrainPollIntervalMs,
                    Math.max(1, deadline - Date.now()),
                ),
            )

            return checkActiveJobs()
        }

        await checkActiveJobs()
    }

    async function snapshotPendingJobs(record: MailRestoreQuiescence) {
        const queueStates = await Promise.all(
            queues.map(async function (queue) {
                const [listJobIds, orderedJobs] = await Promise.all([
                    getPausedJobIds(queue),
                    queue.getJobs(['delayed', 'prioritized']),
                ])
                const pendingJobIds = new Set(listJobIds)

                for (const job of orderedJobs) {
                    if (job.id) {
                        pendingJobIds.add(job.id)
                    }
                }

                const previousState = getStoredQueueState(record, queue.name)

                return {
                    ...previousState,
                    pendingJobIds: [...pendingJobIds],
                }
            }),
        )

        return { ...record, phase: 'paused' as const, queues: queueStates }
    }

    async function refreshPendingJobSnapshot(stored: StoredQuiescence) {
        const snapshot = await snapshotPendingJobs(stored.record)
        const mergedQueueStates = snapshot.queues.map(function (queueState) {
            const previousState = getStoredQueueState(
                stored.record,
                queueState.name,
            )

            return {
                ...queueState,
                pendingJobIds: [
                    ...new Set([
                        ...previousState.pendingJobIds,
                        ...queueState.pendingJobIds,
                    ]),
                ],
            }
        })

        return replaceStoredQuiescence(stored, {
            ...snapshot,
            ownerLeaseUntil: stored.record.ownerLeaseUntil,
            queues: mergedQueueStates,
        })
    }

    async function purgeSnapshottedJobs(record: MailRestoreQuiescence) {
        await forEachSequentially(queues, async function (queue) {
            const queueState = getStoredQueueState(record, queue.name)

            await forEachSequentially(
                queueState.pendingJobIds,
                async function (jobId) {
                    await queue.remove(jobId)
                },
            )
        })
    }

    async function restorePreviousQueueStates(record: MailRestoreQuiescence) {
        await Promise.all(
            queues.map(async function (queue) {
                const queueState = getStoredQueueState(record, queue.name)

                if (queueState.wasPaused) {
                    await queue.pause()
                    return
                }

                await queue.resume()
            }),
        )
    }

    async function releaseWithoutPurge(stored: StoredQuiescence) {
        await restorePreviousQueueStates(stored.record)
        await deleteStoredQuiescence(stored)
    }

    async function purgeStoredQuiescence(stored: StoredQuiescence) {
        await pauseQueues()
        await waitForActiveJobs()

        if (stored.record.phase !== 'purged') {
            await purgeSnapshottedJobs(stored.record)
            stored = await replaceStoredQuiescence(stored, {
                ...stored.record,
                phase: 'purged',
            })
        }

        return stored
    }

    async function purgeAndRelease(stored: StoredQuiescence) {
        stored = await purgeStoredQuiescence(stored)

        await restorePreviousQueueStates(stored.record)
        await deleteStoredQuiescence(stored)
    }

    async function createAndPauseQuiescence(
        observation: RestoreObservation,
        ownerLeaseUntil: number,
        keepPausedOnFailure = false,
    ) {
        const queueStates = await Promise.all(
            queues.map(async function (queue) {
                return {
                    name: queue.name,
                    pendingJobIds: [],
                    wasPaused: await queue.isPaused(),
                }
            }),
        )
        const record: MailRestoreQuiescence = {
            version: 1,
            token: randomUUID(),
            phase: 'pausing',
            ownerLeaseUntil,
            restoreBaseline: getRestoreBaseline(observation),
            queues: queueStates,
        }
        let stored = await createStoredQuiescence(record)

        if (!stored) {
            return null
        }

        try {
            await pauseQueues()
            await waitForActiveJobs()
            stored = await replaceStoredQuiescence(
                stored,
                await snapshotPendingJobs(record),
            )
            return stored
        } catch (error) {
            if (keepPausedOnFailure) {
                try {
                    await pauseQueues()
                } catch (pauseError) {
                    const combinedError = new AggregateError(
                        [error, pauseError],
                        'Mail-Quiesce und fail-closed Pause sind fehlgeschlagen.',
                        { cause: error },
                    )
                    throw combinedError
                }

                throw error
            }

            try {
                await releaseWithoutPurge(stored)
            } catch (releaseError) {
                const combinedError = new AggregateError(
                    [error, releaseError],
                    'Mail-Quiesce und sichere Freigabe sind fehlgeschlagen.',
                    { cause: error },
                )
                throw combinedError
            }

            throw error
        }
    }

    async function reconcileExpiredRunningRestore(
        stored: StoredQuiescence,
        observation: RestoreObservation,
    ) {
        if (
            observation.kind !== 'known' ||
            observation.state?.status !== 'running' ||
            stored.record.ownerLeaseUntil > Date.now()
        ) {
            return false
        }

        try {
            const result = await tryWithExclusiveStorageMutationBarrier(
                async function () {
                    const [latestStored, latestObservation] = await Promise.all(
                        [loadStoredQuiescence(), observeRestoreState()],
                    )

                    if (
                        !latestStored ||
                        latestStored.record.token !== stored.record.token ||
                        latestStored.record.ownerLeaseUntil > Date.now() ||
                        latestObservation.kind !== 'known' ||
                        latestObservation.state?.status !== 'running'
                    ) {
                        return false
                    }

                    const state = latestObservation.state
                    await writeRestoreStateService({
                        status: 'recovery-required',
                        phase: 'rolling-back',
                        percent: null,
                        processedBytes: state.processedBytes,
                        totalBytes: state.totalBytes,
                        startedAt: state.startedAt,
                        updatedAt: new Date().toISOString(),
                    })
                    return true
                },
            )

            return result.acquired && result.result
        } catch (error) {
            logError('mail.restore_quiescence.orphan_recovery_failed', error)
            return false
        }
    }

    async function recoverEmptyUnknownQuiescence(stored: StoredQuiescence) {
        if (
            stored.record.phase !== 'paused' ||
            stored.record.queues.some((queue) => queue.pendingJobIds.length > 0)
        ) {
            return false
        }

        const result = await tryWithExclusiveStorageMutationBarrier(
            async function () {
                const [latestStored, observation] = await Promise.all([
                    loadStoredQuiescence(),
                    observeRestoreState(),
                ])
                if (
                    !latestStored ||
                    latestStored.serialized !== stored.serialized ||
                    latestStored.record.ownerLeaseUntil > Date.now() ||
                    observation.kind !== 'known' ||
                    observation.state !== null
                ) {
                    return false
                }

                const record: MailRestoreQuiescence = {
                    ...latestStored.record,
                    restoreBaseline: { kind: 'known', state: null },
                }
                const serialized = JSON.stringify(record)
                const keys = queues.flatMap((queue) =>
                    [
                        'active',
                        'wait',
                        'paused',
                        'delayed',
                        'prioritized',
                        'waiting-children',
                    ].map((state) => queue.toKey(state)),
                )
                // Leerprüfung und Baseline-Wechsel müssen gegenüber Jobbewegungen und Owner-Leases atomar sein.
                const confirmed = await valkey.eval(
                    confirmEmptyQuiescenceScript,
                    keys.length + 1,
                    MAIL_RESTORE_QUIESCENCE_KEY,
                    ...keys,
                    latestStored.serialized,
                    serialized,
                )
                if (confirmed === 0) return false
                if (confirmed !== 1) {
                    throw new Error(
                        'Der globale Mail-Quiesce wurde parallel verändert.',
                    )
                }
                await releaseWithoutPurge({ record, serialized })
                logInfo('mail.restore_quiescence.empty_orphan_recovered')
                return true
            },
        )
        return result.acquired && result.result
    }

    function startOwnerLeaseHeartbeat(token: string) {
        let pendingHeartbeat = Promise.resolve()
        let stopped = false
        const interval = setInterval(
            function () {
                pendingHeartbeat = pendingHeartbeat.then(async function () {
                    if (stopped) {
                        return undefined
                    }

                    try {
                        const currentStored = await loadStoredQuiescence()

                        if (
                            !currentStored ||
                            currentStored.record.token !== token
                        ) {
                            return undefined
                        }

                        await replaceStoredQuiescence(currentStored, {
                            ...currentStored.record,
                            ownerLeaseUntil: Date.now() + ownerLeaseMs,
                        })
                    } catch (error) {
                        logError(
                            'mail.restore_quiescence.owner_heartbeat_failed',
                            error,
                        )
                    }

                    return undefined
                })
            },
            Math.max(1, Math.floor(ownerLeaseMs / 3)),
        )
        interval.unref()

        return async function stopOwnerLeaseHeartbeat() {
            if (stopped) {
                return
            }

            stopped = true
            clearInterval(interval)
            await pendingHeartbeat
        }
    }

    async function reconcileStartup() {
        clearTimeout(ownerLeaseRecoveryTimer)
        ownerLeaseRecoveryTimer = undefined
        let stored: StoredQuiescence | null

        try {
            stored = await loadStoredQuiescence()
        } catch (error) {
            await pauseQueues()
            await waitForActiveJobs()
            throw error
        }

        const observation = await observeRestoreState()

        if (!stored) {
            if (!isRestoreActive(observation)) {
                return
            }

            stored = await createAndPauseQuiescence(
                observation,
                Date.now() + ownerLeaseMs,
                true,
            )

            if (!stored) {
                stored = await loadStoredQuiescence()
            }

            if (!stored) {
                throw new Error(
                    'Der globale Mail-Quiesce konnte nicht übernommen werden.',
                )
            }

            await pauseQueues()
            await waitForActiveJobs()
        }

        await pauseQueues()
        await waitForActiveJobs()

        if (isRestoreActive(observation)) {
            if (
                observation.kind === 'known' &&
                observation.state?.status === 'running'
            ) {
                if (stored.record.ownerLeaseUntil > Date.now()) {
                    scheduleOwnerLeaseReconciliation(
                        stored.record.ownerLeaseUntil - Date.now() + 1,
                    )
                } else if (
                    !(await reconcileExpiredRunningRestore(stored, observation))
                ) {
                    scheduleOwnerLeaseReconciliation(
                        Math.max(1_000, Math.floor(ownerLeaseMs / 3)),
                    )
                }
            }
            return
        }

        if (stored.record.ownerLeaseUntil > Date.now()) {
            scheduleOwnerLeaseReconciliation(
                stored.record.ownerLeaseUntil - Date.now() + 1,
            )
            return
        }

        if (stored.record.phase === 'pausing') {
            await releaseWithoutPurge(stored)
            return
        }

        if (isNewCompletedRestore(observation, stored.record.restoreBaseline)) {
            await purgeAndRelease(stored)
            return
        }

        if (stored.record.phase === 'purged') {
            throw new Error(
                'Der gepurgte Mail-Quiesce besitzt keinen bestätigten Completed-Marker.',
            )
        }

        if (stored.record.restoreBaseline.kind === 'unknown') {
            if (await recoverEmptyUnknownQuiescence(stored)) return
            throw new Error(
                'Der Mail-Quiesce kann nach einem unbekannten Restore-Zustand nicht automatisch freigegeben werden.',
            )
        }

        await releaseWithoutPurge(stored)
    }

    async function runRestoreQuiesced<TResult>(
        operation: (
            completeRestoreQuiescence: CompleteRestoreQuiescence,
        ) => Promise<TResult>,
    ) {
        await reconcileStartup()

        if (await loadStoredQuiescence()) {
            throw new Error(
                'Ein globaler Mail-Quiesce ist bereits aktiv oder muss manuell geklärt werden.',
            )
        }

        const observation = await observeRestoreState()

        if (isRestoreActive(observation)) {
            await reconcileStartup()
            throw new Error(
                'Ein Restore ist bereits aktiv oder der Restore-Zustand ist unklar.',
            )
        }

        const stored = await createAndPauseQuiescence(
            observation,
            Date.now() + ownerLeaseMs,
        )

        if (!stored) {
            throw new Error('Ein globaler Mail-Quiesce ist bereits aktiv.')
        }

        let completionFinished = false
        let completionStarted = false
        const stopOwnerLeaseHeartbeat = startOwnerLeaseHeartbeat(
            stored.record.token,
        )

        try {
            const result = await operation(
                async function completeRestoreQuiescence(
                    publishCompletedState,
                ) {
                    if (completionStarted) {
                        throw new Error(
                            'Der Mail-Quiesce wurde bereits abgeschlossen.',
                        )
                    }
                    completionStarted = true

                    await stopOwnerLeaseHeartbeat()
                    await valkeyRecoveryPromise
                    let currentStored = await loadStoredQuiescence()

                    if (!currentStored) {
                        throw new Error(
                            'Der globale Mail-Quiesce ist vorzeitig verschwunden.',
                        )
                    }

                    currentStored = await replaceStoredQuiescence(
                        currentStored,
                        {
                            ...currentStored.record,
                            ownerLeaseUntil: Date.now() + ownerLeaseMs,
                        },
                    )
                    currentStored =
                        await refreshPendingJobSnapshot(currentStored)

                    const purgedStored =
                        await purgeStoredQuiescence(currentStored)
                    await publishCompletedState()
                    await restorePreviousQueueStates(purgedStored.record)
                    await deleteStoredQuiescence(purgedStored)
                    completionFinished = true
                },
            )

            if (!completionFinished) {
                throw new Error(
                    'Der Restore wurde ohne Mail-Quiesce-Abschluss beendet.',
                )
            }

            return result
        } catch (error) {
            const currentStored = await loadStoredQuiescence()

            if (!currentStored) {
                throw error
            }

            const finalObservation = await observeRestoreState()

            try {
                if (isRestoreActive(finalObservation)) {
                    await pauseQueues()
                    await waitForActiveJobs()
                } else if (
                    isNewCompletedRestore(
                        finalObservation,
                        currentStored.record.restoreBaseline,
                    )
                ) {
                    await purgeAndRelease(currentStored)
                } else if (currentStored.record.phase === 'purged') {
                    await pauseQueues()
                    await waitForActiveJobs()
                } else {
                    await releaseWithoutPurge(currentStored)
                }
            } catch (cleanupError) {
                const combinedError = new AggregateError(
                    [error, cleanupError],
                    'Restore und Mail-Quiesce-Abschluss sind fehlgeschlagen.',
                    { cause: error },
                )
                throw combinedError
            }

            throw error
        } finally {
            await stopOwnerLeaseHeartbeat()
        }
    }

    function handleValkeyReady() {
        valkeyRecoveryPromise = valkeyRecoveryPromise.then(async function () {
            try {
                await reconcileStartup()
            } catch (error) {
                logError(
                    'mail.restore_quiescence.valkey_recovery_failed',
                    error,
                )
            }

            return undefined
        })
    }

    function scheduleOwnerLeaseReconciliation(delayMs: number) {
        clearTimeout(ownerLeaseRecoveryTimer)
        ownerLeaseRecoveryTimer = setTimeout(handleValkeyReady, delayMs)
        ownerLeaseRecoveryTimer.unref()
    }

    return {
        close: async function () {
            if (valkeyRecoveryStarted) {
                valkey.off('ready', handleValkeyReady)
            }
            clearTimeout(ownerLeaseRecoveryTimer)
            await valkeyRecoveryPromise
            await Promise.all(queues.map((queue) => queue.close()))
        },
        isRestoreQuiescenceActive: async function (this: void) {
            try {
                return (await valkey.get(MAIL_RESTORE_QUIESCENCE_KEY)) !== null
            } catch {
                return true
            }
        },
        isRestoreQuiescenceHealthyPaused: async function (this: void) {
            try {
                const [stored, observation] = await Promise.all([
                    loadStoredQuiescence(),
                    observeRestoreState(),
                ])

                return Boolean(
                    stored &&
                    observation.kind === 'known' &&
                    (observation.state?.status === 'running' ||
                        observation.state?.status === 'recovery-required'),
                )
            } catch {
                return false
            }
        },
        reconcileStartup,
        runRestoreQuiesced,
        startValkeyRecovery: function () {
            if (valkeyRecoveryStarted) {
                return
            }

            valkeyRecoveryStarted = true
            valkey.on('ready', handleValkeyReady)
        },
    }
}
