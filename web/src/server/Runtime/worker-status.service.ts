import { z } from 'zod'
import { WORKER_HEALTH } from '@/config/health.config.ts'
import { logWarn } from '@/server/Logging/logger.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import type {
    WorkerRuntimeHealth,
    WorkerStatusReporter,
} from './Types/worker-status.types.ts'

const workerStatusSchema = z
    .object({
        version: z.literal(1),
        instanceId: z.uuid(),
        status: z.enum(['starting', 'running', 'error']),
        updatedAt: z.number().int().nonnegative(),
    })
    .strict()

const clearWorkerStatusScript = `
if server.call('GET', KEYS[1]) == ARGV[1] then
    return server.call('DEL', KEYS[1])
end
return 0
`

export function createWorkerStatusReporterService(): WorkerStatusReporter {
    const instanceId = crypto.randomUUID()
    let lastPublishedStatus: string | null = null

    return {
        reportStatus: async function (status) {
            try {
                const content = JSON.stringify({
                    version: 1,
                    instanceId,
                    status,
                    updatedAt: Date.now(),
                })
                await getValkeyConnection().set(
                    WORKER_HEALTH.statusKey,
                    content,
                    'PX',
                    WORKER_HEALTH.maxAgeMs,
                )
                lastPublishedStatus = content
            } catch {
                logWarn('background_worker.status_publish_failed')
            }
        },
        stop: async function () {
            if (!lastPublishedStatus) return

            try {
                await getValkeyConnection().eval(
                    clearWorkerStatusScript,
                    1,
                    WORKER_HEALTH.statusKey,
                    lastPublishedStatus,
                )
            } catch {
                logWarn('background_worker.status_cleanup_failed')
            }
        },
    }
}

export async function getWorkerRuntimeHealthService(): Promise<WorkerRuntimeHealth> {
    const content = await getValkeyConnection().get(WORKER_HEALTH.statusKey)
    if (content === null) return { status: 'down', reason: 'missing' }

    try {
        const heartbeat = workerStatusSchema.parse(JSON.parse(content))
        const age = Date.now() - heartbeat.updatedAt
        if (age < 0 || age > WORKER_HEALTH.maxAgeMs) {
            return { status: 'down', reason: 'expired' }
        }

        return { status: heartbeat.status, reason: 'heartbeat' }
    } catch {
        return { status: 'error', reason: 'invalid' }
    }
}
