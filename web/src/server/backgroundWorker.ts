import {
    validateBackupWorkerEnvironment,
    validateDatabaseEnvironment,
    validateMailWorkerEnvironment,
} from '@/server/Runtime/environment.service.ts'
import {
    isBackgroundWorkerRuntimeHealthyService,
    startWorkerHeartbeatService,
} from '@/server/Runtime/worker-health.service.ts'
import { createWorkerStatusReporterService } from '@/server/Runtime/worker-status.service.ts'
import { logError, logInfo } from '@/server/Logging/logger.ts'
import { closeCoreWorkerPoolsService } from '@/server/Core/worker-pool.service.ts'
import { closePrivateStorageWritesService } from '@/server/Storage/private-write-queue.service.ts'
import { setRuntimeLogProcessService } from '@/server/Logging/runtime-log-history.service.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import { waitForValkeyReadyService } from '@/server/Valkey/valkey-availability.service.ts'
import {
    closeBackgroundWorkersService,
    createBackupWorkerStartCoordinatorService,
} from '@/server/Runtime/backup-worker-start.service.ts'
import {
    installStorageMutationBarrierFatalExitHandlerService,
    isStorageMutationBarrierHealthyService,
} from '@/server/Storage/storage-mutation-barrier-health.service.ts'

import { assertRuntimeDatabaseRolePolicyService } from '@/server/Runtime/database-role-policy.service.ts'
import { createWorkerShutdownService } from '@/server/Runtime/worker-shutdown.service.ts'
import type { startMailWorker } from '@/server/Queues/mail.worker.ts'
import { candidateGitHubToken } from '@/server/Marketplace/Submissions/github.service.ts'

setRuntimeLogProcessService('worker')
installStorageMutationBarrierFatalExitHandlerService()

if (process.env.NODE_ENV === 'production') {
    validateMailWorkerEnvironment()
    const environment = validateBackupWorkerEnvironment()
    await assertRuntimeDatabaseRolePolicyService(environment.DATABASE_URL)
} else {
    validateDatabaseEnvironment()
}

logInfo('background_worker.waiting_for_valkey')
await waitForValkeyReadyService()

const workerStatusReporter = createWorkerStatusReporterService()
await workerStatusReporter.reportStatus('starting')

const startupReady = Promise.withResolvers<void>()
let mailWorker: Awaited<ReturnType<typeof startMailWorker>> | undefined
let candidateWorker: Promise<void> | undefined
let backupWorkerStarter:
    ReturnType<typeof createBackupWorkerStartCoordinatorService> | undefined
let workerHeartbeat:
    Awaited<ReturnType<typeof startWorkerHeartbeatService>> | undefined
const shutdown = createWorkerShutdownService({
    ready: startupReady.promise,
    stopHeartbeat: async function () {
        await workerHeartbeat?.stop()
    },
    closeWorkers: async function () {
        try {
            await candidateWorker
            await backupWorkerStarter?.stop()
        } finally {
            try {
                await closeBackgroundWorkersService({
                    backupWorker: backupWorkerStarter?.getWorker() ?? null,
                    closeMailWorker: async function () {
                        await mailWorker?.close()
                    },
                })
            } finally {
                try {
                    await closePrivateStorageWritesService()
                } finally {
                    await closeCoreWorkerPoolsService()
                }
            }
        }
    },
    stopStatus: () => workerStatusReporter.stop(),
})

let shutdownWasRequested = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, function () {
        if (shutdownWasRequested) return
        shutdownWasRequested = true
        void shutdown.shutdown().then(
            (exitCode) => process.exit(exitCode),
            function (error) {
                logError('background_worker.shutdown_failed', error)
                process.exit(1)
            },
        )
    })
}

async function startWorkers() {
    if (shutdown.signal.aborted) return
    // Mail-Abhängigkeiten initialisieren den Datenbankclient bereits beim Import.
    const { startMailWorker } = await import('@/server/Queues/mail.worker.ts')
    if (shutdown.signal.aborted) return
    mailWorker = await startMailWorker()
    if (shutdown.signal.aborted) return
    const currentMailWorker = mailWorker
    const backupStarter = createBackupWorkerStartCoordinatorService({
        isRestoreQuiescenceActive: currentMailWorker.isRestoreQuiescenceActive,
        startBackupWorker: async function () {
            const { startBackupWorker } =
                await import('@/server/Admin/Backups/backup.worker.ts')
            return startBackupWorker({
                isRestoreQuiescenceActive:
                    currentMailWorker.isRestoreQuiescenceActive,
                runRestoreQuiesced: currentMailWorker.runRestoreQuiesced,
            })
        },
    })
    backupWorkerStarter = backupStarter

    try {
        if (!(await backupStarter.startWhenAvailable())) {
            logInfo('backup.worker.start_skipped_restore_quiescence')
        }
    } catch (error) {
        logError('backup.worker.start_failed', error)
        if (process.env.NODE_ENV === 'production') throw error
    }
    if (shutdown.signal.aborted) return

    if (candidateGitHubToken()) {
        const { runCandidateValidationWorker } =
            await import('@/server/Marketplace/Submissions/validation.worker.ts')
        if (shutdown.signal.aborted) return
        candidateWorker = runCandidateValidationWorker(
            shutdown.signal,
            currentMailWorker.isRestoreQuiescenceActive,
        )
    }

    logInfo('background_worker.started', {
        backupConcurrency: backupStarter.getWorker() ? 1 : 0,
        mailConcurrency: 5,
    })
    // All queue consumers are now owned by shutdown; a stalled first probe must not delay it.
    startupReady.resolve()
    workerHeartbeat = await startWorkerHeartbeatService({
        signal: shutdown.signal,
        isHealthy: async function () {
            try {
                await backupStarter.startWhenAvailable()
            } catch (error) {
                logError('backup.worker.deferred_start_failed', error)
                return false
            }

            const backupWorker = backupStarter.getWorker()
            return isBackgroundWorkerRuntimeHealthyService({
                isMailWorkerRunning: currentMailWorker.isRunning,
                isBackupWorkerRunning: backupWorker
                    ? () => backupWorker.isRunning()
                    : null,
                isRestoreQuiescenceHealthyPaused:
                    currentMailWorker.isRestoreQuiescenceHealthyPaused,
                isStorageMutationBarrierHealthy:
                    isStorageMutationBarrierHealthyService,
                pingValkey: () => getValkeyConnection().ping(),
            })
        },
        onError: function (error) {
            logError('background_worker.heartbeat_failed', error)
        },
        onHeartbeat: function (isHealthy) {
            return workerStatusReporter.reportStatus(
                isHealthy ? 'running' : 'error',
            )
        },
    })
}

try {
    await startWorkers()
} catch (error) {
    logError('background_worker.start_failed', error)
    startupReady.resolve()
    await shutdown.shutdown()
    throw error
} finally {
    startupReady.resolve()
}
