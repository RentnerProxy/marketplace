import { CONTAINER_LOGS } from '@/config/logging.config.ts'
import { fetchLoopbackJsonService } from '@/server/Core/loopback-client.service.ts'
import type {
    RuntimeLogServiceId,
    RuntimeLogSnapshot,
} from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'
import {
    containerLogReaderOriginSchema,
    containerLogSnapshotSchema,
} from './container-log.validation.ts'

export function getContainerLogReaderOriginService(): string | null {
    const configured = process.env.CONTAINER_LOG_READER_URL?.trim()
    return configured ? containerLogReaderOriginSchema.parse(configured) : null
}

export async function getContainerLogsService(
    origin: string,
    service: RuntimeLogServiceId,
): Promise<RuntimeLogSnapshot> {
    try {
        const response = await fetchLoopbackJsonService(
            origin,
            '/logs',
            new URLSearchParams({ service }),
            {
                timeoutMs: CONTAINER_LOGS.requestTimeoutMs,
                maxResponseBytes: CONTAINER_LOGS.maxResponseBytes,
                responseName: 'Container logs',
            },
        )
        return containerLogSnapshotSchema.parse(response)
    } catch {
        throw new Error('container_logs_unavailable')
    }
}
