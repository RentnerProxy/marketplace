/* eslint-disable no-await-in-loop -- Recheck processors before each bounded cleanup attempt. */
import { WORKER_SHUTDOWN } from '@/config/health.config.ts'
import { logInfo, logWarn } from '@/server/Logging/logger.ts'
import { waitForWorkerCleanupService } from './worker-cleanup.service.ts'
import type {
    ClosableQueueWorker,
    RuntimeQueueName,
} from './Types/queue-worker-lifecycle.types.ts'

export function createQueueWorkerLifecycleService(queueName: RuntimeQueueName) {
    let activeJobs = 0
    let shutdown: Promise<void> | undefined
    const idleWaiters = new Set<() => void>()

    async function runJob<TResult>(operation: () => Promise<TResult>) {
        activeJobs += 1
        try {
            return await operation()
        } finally {
            activeJobs -= 1
            if (activeJobs === 0) {
                for (const resolve of idleWaiters) resolve()
                idleWaiters.clear()
            }
        }
    }

    async function close(worker: ClosableQueueWorker) {
        logInfo('queue.worker.shutdown_started', {
            queueName,
            count: activeJobs,
        })
        const closing = worker.close()
        // Jobs may outlive a failed close. Observe it now, then handle it after draining.
        void closing.catch(() => undefined)
        const progress = setInterval(function () {
            if (activeJobs > 0)
                logInfo('queue.worker.shutdown_waiting', {
                    queueName,
                    count: activeJobs,
                })
        }, WORKER_SHUTDOWN.progressIntervalMs)

        try {
            while (true) {
                if (activeJobs > 0) {
                    await new Promise<void>(function (resolve) {
                        idleWaiters.add(resolve)
                    })
                }
                if (await waitForWorkerCleanupService(closing)) {
                    if (activeJobs > 0) continue
                    break
                }
                if (activeJobs > 0) continue

                // Only disconnect queue sockets after every processor has finished.
                logWarn('queue.worker.shutdown_disconnect', { queueName })
                if (!(await waitForWorkerCleanupService(worker.disconnect()))) {
                    throw new Error(
                        'Queue-Verbindungen konnten nicht beendet werden.',
                    )
                }
                break
            }
            logInfo('queue.worker.shutdown_completed', { queueName })
        } finally {
            clearInterval(progress)
        }
    }

    return {
        runJob,
        close: function (worker: ClosableQueueWorker) {
            shutdown ??= close(worker)
            return shutdown
        },
    }
}
