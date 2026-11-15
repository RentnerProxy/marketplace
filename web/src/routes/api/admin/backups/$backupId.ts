import { createFileRoute } from '@tanstack/react-router'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { backupIdInputSchema } from '@/features/Admin/Backups/validation.ts'
import {
    prepareAuditContextService,
    writeStandaloneAuditLogService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { normalizeError } from '@/lib/Errors/error.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    BackupApiError,
    createBackupApiErrorResponse,
    createBackupDownloadHeaders,
} from '@/server/Admin/Backups/http.service.ts'
import { getBackupRunById } from '@/server/Admin/Backups/run-registry.service.ts'
import { prepareBackupDownloadService } from '@/server/Admin/Backups/download.service.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'

export async function handleStoredBackupDownload({
    params,
    request,
}: {
    params: { backupId: string }
    request: Request
}) {
    try {
        await enforceRateLimit({
            ...RATE_LIMITS.backupDownload,
            scope: 'backup-download',
        })
        const access = await requirePermissionService(PERMISSIONS.ADMIN_BACKUPS)
        const input = backupIdInputSchema.safeParse({
            backupId: params.backupId,
        })

        if (!input.success) {
            throw normalizeError(
                new BackupApiError(400, 'Die Backup-ID ist ungültig.'),
            )
        }

        const backup = await getBackupRunById(input.data.backupId)

        if (!backup?.fileName || backup.status !== 'completed') {
            throw normalizeError(
                new BackupApiError(404, 'Backup nicht gefunden.'),
            )
        }

        const download = await prepareBackupDownloadService({
            fileName: backup.fileName,
            fileSize: backup.fileSize,
            checksumSha256: backup.checksumSha256,
            signal: request.signal,
        })
        try {
            await writeStandaloneAuditLogService({
                action: 'admin.backups.downloaded',
                ...prepareAuditContextService(access.userId, {
                    route: '/api/admin/backups/:backupId',
                    method: 'GET',
                }),
                message:
                    'Gespeichertes Backup wurde zum Download bereitgestellt.',
                newValues: { backupRunId: backup.id },
            })

            return new Response(download.createBody(), {
                headers: createBackupDownloadHeaders(
                    download.fileName,
                    download.fileSize,
                ),
            })
        } catch (error) {
            await download.dispose()
            throw error
        }
    } catch (error) {
        return createBackupApiErrorResponse(
            error,
            'backup.download.stored_failed',
            'Das Backup konnte nicht heruntergeladen werden.',
        )
    }
}

export const Route = createFileRoute('/api/admin/backups/$backupId')({
    server: {
        handlers: {
            GET: handleStoredBackupDownload,
        },
    },
})
