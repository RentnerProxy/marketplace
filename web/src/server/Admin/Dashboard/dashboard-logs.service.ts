import type { DashboardServiceId } from '@/features/Admin/Dashboard/Types/dashboard-domain.types.ts'
import { RUNTIME_LOGS } from '@/config/logging.config.ts'
import type { RuntimeLogSnapshot } from '@/lib/RuntimeLogs/Types/runtime-log.types.ts'
import { getRuntimeLogSnapshotService } from '@/server/Logging/runtime-log-history.service.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import { getCoreRuntimeOriginService } from '@/server/Core/health.service.ts'
import {
    getContainerLogReaderOriginService,
    getContainerLogsService,
} from '@/server/Logging/container-log-client.service.ts'

export async function getDashboardLogsService(
    service: DashboardServiceId,
): Promise<RuntimeLogSnapshot> {
    const readerOrigin =
        service === 'core'
            ? getCoreRuntimeOriginService()
            : getContainerLogReaderOriginService()
    if (!readerOrigin)
        return getRuntimeLogSnapshotService(service, getValkeyConnection())

    const [container, application] = await Promise.all([
        getContainerLogsService(readerOrigin, service),
        getRuntimeLogSnapshotService(service, getValkeyConnection()),
    ])
    return {
        source: 'container',
        sharedHistoryAvailable:
            container.sharedHistoryAvailable &&
            application.sharedHistoryAvailable,
        entries: [
            ...container.entries,
            ...application.entries.filter((entry) =>
                entry.event.startsWith('health.'),
            ),
        ]
            .toSorted(
                (left, right) =>
                    Date.parse(left.timestamp) - Date.parse(right.timestamp),
            )
            .slice(-RUNTIME_LOGS.maxEntries),
    }
}
