import { createServerFn } from '@tanstack/react-start'
import { getAuditLogsService } from '@/server/Admin/AuditLogs/get.service.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'

export const getAuditLogsHandler = createServerFn({ method: 'GET' }).handler(
    async function () {
        await requirePermissionService(PERMISSIONS.ADMIN_AUDIT_LOGS)
        return getAuditLogsService()
    },
)
