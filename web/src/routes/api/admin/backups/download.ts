import { createFileRoute } from '@tanstack/react-router'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createBackupApiErrorResponse } from '@/server/Admin/Backups/http.service.ts'
import { createManualBackupForDownloadService } from '@/server/Admin/Backups/run-create.service.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { assertSameOriginRequest } from '@/server/Request/sameOrigin.service.ts'

export async function handleBackupDownload({ request }: { request: Request }) {
    try {
        assertSameOriginRequest(request)
        await enforceRateLimit({
            ...RATE_LIMITS.backupCreate,
            scope: 'backup-create-download',
        })
        const access = await requirePermissionService(PERMISSIONS.ADMIN_BACKUPS)
        const result = await createManualBackupForDownloadService(access.userId)

        return Response.json(
            {
                success: true,
                backupId: result.runId,
            },
            {
                status: 202,
                headers: {
                    location:
                        '/api/admin/backups/' +
                        encodeURIComponent(result.runId),
                },
            },
        )
    } catch (error) {
        return createBackupApiErrorResponse(
            error,
            'backup.download.create_failed',
            'Das Backup konnte nicht erstellt werden.',
        )
    }
}

export const Route = createFileRoute('/api/admin/backups/download')({
    server: {
        handlers: {
            POST: handleBackupDownload,
        },
    },
})
