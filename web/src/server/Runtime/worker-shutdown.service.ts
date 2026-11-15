import { logError, logInfo, logWarn } from '@/server/Logging/logger.ts'
import { waitForWorkerCleanupService } from './worker-cleanup.service.ts'
import type { WorkerShutdownOptions } from './Types/worker-shutdown.types.ts'

export function createWorkerShutdownService(options: WorkerShutdownOptions) {
    const controller = new AbortController()
    let shutdown: Promise<number> | undefined

    async function stop() {
        const startedAt = Date.now()
        let failures = 0
        logInfo('background_worker.shutdown_started')
        await options.ready

        async function cleanup(
            name: 'heartbeat' | 'status',
            operation: () => Promise<void>,
        ) {
            try {
                if (!(await waitForWorkerCleanupService(operation()))) {
                    failures += 1
                    logWarn(`background_worker.shutdown_${name}_timeout`)
                }
            } catch (error) {
                failures += 1
                logError(`background_worker.shutdown_${name}_failed`, error)
            }
        }

        await cleanup('heartbeat', options.stopHeartbeat)
        try {
            await options.closeWorkers()
        } catch (error) {
            failures += 1
            logError('background_worker.shutdown_workers_failed', error)
        }
        await cleanup('status', options.stopStatus)
        logInfo('background_worker.shutdown_completed', {
            durationMs: Date.now() - startedAt,
            count: failures,
        })
        return failures === 0 ? 0 : 1
    }

    return {
        signal: controller.signal,
        shutdown: function () {
            controller.abort()
            shutdown ??= stop()
            return shutdown
        },
    }
}
