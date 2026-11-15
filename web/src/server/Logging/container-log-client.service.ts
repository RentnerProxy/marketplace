import { CONTAINER_LOGS } from '@/config/logging.config.ts'
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
    const url = new URL('/logs', origin)
    url.searchParams.set('service', service)
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(
                CONTAINER_LOGS.requestTimeoutMs * 2 + 1000,
            ),
            redirect: 'error',
            cache: 'no-store',
        })
        if (!response.ok) throw new Error('container_logs_unavailable')
        return containerLogSnapshotSchema.parse(await response.json())
    } catch {
        throw new Error('container_logs_unavailable')
    }
}
