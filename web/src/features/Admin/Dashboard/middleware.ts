import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { getDashboardLogsService } from '@/server/Admin/Dashboard/dashboard-logs.service.ts'
import {
    getDashboardHealthService,
    getDashboardRateLimitUnavailableHealthService,
} from '@/server/Admin/Dashboard/dashboard-health.service.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import {
    enforceRateLimit,
    RateLimitError,
} from '@/server/RateLimit/rateLimit.service.ts'
import { dashboardLogsInputSchema } from './validation.ts'
import { getContainerLogReaderOriginService } from '@/server/Logging/container-log-client.service.ts'

export const getDashboardLogsHandler = createServerFn({ method: 'GET' })
    .validator((data: unknown) => dashboardLogsInputSchema.parse(data))
    .handler(async function ({ data }) {
        const { userId } = await requirePermissionService(
            PERMISSIONS.ADMIN_DASHBOARD,
        )
        if (data.service === 'core' || getContainerLogReaderOriginService()) {
            await requirePermissionService(PERMISSIONS.ADMIN_SUPER_USER)
        }
        await enforceRateLimit({
            ...RATE_LIMITS.adminDashboardLogsRead,
            scope: 'admin-dashboard-logs-read',
            identifiers: [userId],
            includeClientIp: false,
        })
        return getDashboardLogsService(data.service)
    })

export const getDashboardHealthHandler = createServerFn({
    method: 'GET',
}).handler(async function () {
    const { userId } = await requirePermissionService(
        PERMISSIONS.ADMIN_DASHBOARD,
    )
    try {
        await enforceRateLimit({
            ...RATE_LIMITS.adminDashboardRead,
            scope: 'admin-dashboard-read',
            identifiers: [userId],
            includeClientIp: false,
        })
    } catch (error) {
        if (error instanceof RateLimitError) throw error
        // Ohne bestätigtes Rate-Limit keine weiteren Statusprüfungen ausführen.
        return getDashboardRateLimitUnavailableHealthService()
    }
    return getDashboardHealthService()
})
