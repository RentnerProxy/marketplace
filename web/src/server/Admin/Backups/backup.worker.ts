import type {
    BackupJobData,
    StartBackupWorkerOptions,
} from '@/server/Admin/Backups/Types/backup-worker.types.ts'
import { UnrecoverableError, Worker, type Job } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { BACKUP_QUEUE_NAME, BACKUP_TIMEOUTS } from '@/config/backup.config.ts'
import {
    getBullMqConnectionOptions,
    getValkeyConnection,
} from '@/server/Valkey/valkey.service.ts'
import {
    processBackupJob,
    reconcileFailedBackupJob,
} from './run-job.service.ts'
import {
    getOrCreateBackupSettings,
    serializeBackupSettings,
} from './settings.service.ts'
import {
    getBackupQueue,
    parseBackupJobContract,
    syncBackupScheduler,
} from './backup.queue.ts'

import { logError } from '@/server/Logging/logger.ts'
import {
    createSafeErrorForStorageService,
    getOwnLogValue,
} from '@/server/Logging/error-details.ts'
import { reconcileLostBackupQueueState } from './backup-recovery.service.ts'
import type { BackupJobProgress } from '@/lib/Backups/Types/backup.types.ts'
import {
    RestoreInProgressError,
    withSharedStorageMutationBarrier,
} from '@/server/Storage/storage-mutation-barrier.service.ts'
import { createQueueWorkerLifecycleService } from '@/server/Runtime/queue-worker-lifecycle.service.ts'
import { waitForWorkerCleanupService } from '@/server/Runtime/worker-cleanup.service.ts'

const BACKUP_PROGRESS_UPDATE_INTERVAL_MS = 500

function createBackupProgressReporter(job: Job<BackupJobData>) {
    let lastPhase: BackupJobProgress['phase'] | undefined
    let lastPublishedAt = 0

    return async function reportProgress(progress: BackupJobProgress) {
        const now = Date.now()
        const isPhaseChange = progress.phase !== lastPhase
        const isComplete =
            progress.totalBytes > 0 &&
            progress.processedBytes >= progress.totalBytes

        if (
            !isPhaseChange &&
            !isComplete &&
            now - lastPublishedAt < BACKUP_PROGRESS_UPDATE_INTERVAL_MS
        ) {
            return
        }

        lastPhase = progress.phase
        lastPublishedAt = now
        await job.updateProgress(progress)
    }
}

export async function startBackupWorker(options: StartBackupWorkerOptions) {
    const lifecycle = createQueueWorkerLifecycleService(BACKUP_QUEUE_NAME)
    let isClosing = false
    await withSharedStorageMutationBarrier(async function () {
        if (await options.isRestoreQuiescenceActive()) {
            throw new RestoreInProgressError()
        }

        const settings = serializeBackupSettings(
            await getOrCreateBackupSettings(),
        )
        await syncBackupScheduler(settings)
        await getBackupQueue().setGlobalConcurrency(1)
    })
    const activeRunIds = new Set<string>()
    let runValkeyRecovery: (() => void) | undefined

    const worker = new Worker<BackupJobData>(
        BACKUP_QUEUE_NAME,
        (job) =>
            lifecycle.runJob(async function () {
                try {
                    let jobData = parseBackupJobContract(job.name, job.data)

                    if (
                        jobData.kind === 'create' &&
                        jobData.trigger === 'scheduled' &&
                        !jobData.runId
                    ) {
                        jobData = { ...jobData, runId: randomUUID() }
                        await job.updateData(jobData)
                    }

                    if (jobData.runId) {
                        activeRunIds.add(jobData.runId)
                    }

                    try {
                        const reportProgress = createBackupProgressReporter(job)

                        if (jobData.kind === 'restore') {
                            return await options.runRestoreQuiesced(
                                function (completeRestoreQuiescence) {
                                    return processBackupJob(jobData, {
                                        completeRestoreQuiescence,
                                        reportProgress,
                                    })
                                },
                            )
                        }

                        return await withSharedStorageMutationBarrier(
                            function () {
                                return processBackupJob(jobData, {
                                    reportProgress,
                                })
                            },
                        )
                    } finally {
                        if (jobData.runId) {
                            activeRunIds.delete(jobData.runId)
                        }

                        if (jobData.kind === 'restore') {
                            runValkeyRecovery?.()
                        }
                    }
                } catch (error) {
                    logError('backup.job.processor_failed', error, {
                        jobId: job.id,
                        jobName: job.name,
                    })
                    throw createSafeErrorForStorageService(
                        error,
                        'Der Backup-Job ist fehlgeschlagen.',
                        getOwnLogValue(error, 'name') === 'UnrecoverableError'
                            ? (message) => new UnrecoverableError(message)
                            : undefined,
                    )
                }
            }),
        {
            autorun: false,
            concurrency: 1,
            connection: getBullMqConnectionOptions(),
            lockDuration: 10 * 60_000,
        },
    )

    let valkey: ReturnType<typeof getValkeyConnection> | undefined
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined
    let recoveryPromise = Promise.resolve()
    let valkeyReadyListenerWasAttached = false

    runValkeyRecovery = function () {
        if (isClosing) return
        recoveryPromise = recoveryPromise.then(function () {
            return synchronizeAfterValkeyReconnect(activeRunIds, options)
        })
    }

    function handleValkeyReady() {
        if (isClosing) return
        runValkeyRecovery?.()
        clearTimeout(recoveryTimer)
        recoveryTimer = setTimeout(function () {
            runValkeyRecovery?.()
        }, BACKUP_TIMEOUTS.valkeyRecoveryGraceMs + 1_000)
        recoveryTimer.unref()
    }

    function detachValkeyReadyListener() {
        if (!valkey || !valkeyReadyListenerWasAttached) {
            return
        }

        valkey.off('ready', handleValkeyReady)
        valkeyReadyListenerWasAttached = false
    }

    try {
        worker.on('failed', function (job, error) {
            logError('backup.job.failed', error, {
                jobId: job?.id ?? 'unknown',
                jobName: job?.name,
            })

            if (job) {
                void reconcileFinalFailure(job, error, options)
            }
        })

        worker.on('error', function (error) {
            logError('backup.worker.error', error)
        })

        valkey = getValkeyConnection()
        await valkey.ping()
        valkeyReadyListenerWasAttached = true
        valkey.on('ready', handleValkeyReady)
        worker.once('closed', function () {
            detachValkeyReadyListener()
            clearTimeout(recoveryTimer)
        })
        void worker.run().catch(function (error) {
            logError('backup.worker.run_failed', error)
        })

        return {
            close: async function () {
                isClosing = true
                detachValkeyReadyListener()
                clearTimeout(recoveryTimer)
                await lifecycle.close(worker)
                if (!(await waitForWorkerCleanupService(recoveryPromise))) {
                    throw new Error(
                        'Backup-Queue-Cleanup konnte nicht beendet werden.',
                    )
                }
            },
            isRunning: () => worker.isRunning(),
        }
    } catch (error) {
        const cleanupErrors: unknown[] = []

        try {
            detachValkeyReadyListener()
        } catch (listenerCleanupError) {
            cleanupErrors.push(listenerCleanupError)
        }

        clearTimeout(recoveryTimer)

        try {
            await recoveryPromise
        } catch (recoveryError) {
            cleanupErrors.push(recoveryError)
        }

        try {
            await lifecycle.close(worker)
        } catch (workerCleanupError) {
            cleanupErrors.push(workerCleanupError)
        }

        if (cleanupErrors.length > 0) {
            throw new AggregateError(
                [error, ...cleanupErrors],
                'Backup-Worker-Startup und Cleanup sind fehlgeschlagen.',
                { cause: error },
            )
        }

        throw error
    }
}

async function synchronizeAfterValkeyReconnect(
    activeRunIds: ReadonlySet<string>,
    options: StartBackupWorkerOptions,
) {
    try {
        await runBackgroundMutation(options, async function () {
            const settings = serializeBackupSettings(
                await getOrCreateBackupSettings(),
            )
            await syncBackupScheduler(settings)
            await getBackupQueue().setGlobalConcurrency(1)
            await reconcileLostBackupQueueState(activeRunIds)
        })
    } catch (error) {
        logError('backup.valkey_recovery.failed', error)
    }
}

async function reconcileFinalFailure(
    job: Job<BackupJobData>,
    error: Error,
    options: StartBackupWorkerOptions,
) {
    try {
        if ((await job.getState()) === 'failed') {
            await runBackgroundMutation(options, function () {
                return reconcileFailedBackupJob(job.data, error)
            })
        }
    } catch (reconciliationError) {
        logError(
            'backup.job.failure_reconciliation_failed',
            reconciliationError,
            { jobId: job.id ?? 'unknown' },
        )
    }
}

async function runBackgroundMutation(
    options: StartBackupWorkerOptions,
    operation: () => Promise<void>,
) {
    if (await options.isRestoreQuiescenceActive()) {
        return false
    }

    try {
        await withSharedStorageMutationBarrier(async function () {
            if (await options.isRestoreQuiescenceActive()) {
                throw new RestoreInProgressError()
            }

            await operation()
        })
        return true
    } catch (error) {
        if (error instanceof RestoreInProgressError) {
            return false
        }

        throw error
    }
}
