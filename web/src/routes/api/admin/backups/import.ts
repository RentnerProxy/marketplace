import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { createFileRoute } from '@tanstack/react-router'
import { BACKUP_LIMITS } from '@/config/backup.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { publishCommittedAuditLogService } from '@/lib/AuditLogs/auditLogs.ts'
import { applyBackupRetentionBestEffort } from '@/server/Admin/Backups/run-retention.service.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { prepareUploadedBackupImport } from '@/server/Admin/Backups/archive-import.service.ts'
import { acquireBackupImportAdmissionService } from '@/server/Admin/Backups/import-admission.service.ts'
import { BackupImportError } from '@/server/Admin/Backups/backup.errors.ts'
import type { BackupImportContext } from '@/server/Admin/Backups/Types/import.types.ts'
import {
    BackupApiError,
    createBackupApiErrorResponse,
} from '@/server/Admin/Backups/http.service.ts'
import { registerImportedBackupService } from '@/server/Admin/Backups/run-create.service.ts'
import {
    receiveBackupUpload,
    validateBackupUploadRequest,
} from '@/server/Admin/Backups/upload.service.ts'
import { requirePermissionService } from '@/server/Auth/authorization.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { assertSameOriginRequest } from '@/server/Request/sameOrigin.service.ts'

function normalizeImportError(
    error: unknown,
    context: BackupImportContext,
    fallback: BackupApiError,
): never {
    if (error instanceof BackupImportError) throw error
    if (
        error instanceof AggregateError &&
        error.cause instanceof BackupImportError
    ) {
        throw error.cause
    }
    context.assertActive()
    if (error instanceof PermissionDeniedError) throw error
    throw fallback
}

async function importAdmittedBackup(
    request: Request,
    userId: string,
    context: BackupImportContext,
) {
    let upload: Awaited<ReturnType<typeof receiveBackupUpload>>
    try {
        upload = await receiveBackupUpload(request, context)
    } catch (error) {
        normalizeImportError(
            error,
            context,
            new BackupApiError(
                400,
                'Es wurde keine gültige Backup-Datei übermittelt.',
                { cause: error },
            ),
        )
    }
    try {
        context.assertActive()
        let imported: Awaited<ReturnType<typeof prepareUploadedBackupImport>>
        try {
            imported = await prepareUploadedBackupImport(
                upload.filePath,
                context,
            )
        } catch (error) {
            normalizeImportError(
                error,
                context,
                new BackupApiError(
                    400,
                    'Die Backup-Datei ist ungültig oder wird nicht unterstützt.',
                    { cause: error },
                ),
            )
        }

        let result: Awaited<ReturnType<typeof registerImportedBackupService>>
        try {
            context.assertActive()
            result = await registerImportedBackupService(
                {
                    fileName: imported.fileName,
                    fileSize: imported.fileSize,
                    checksumSha256: imported.checksumSha256,
                    includesStorage: imported.includesStorage,
                    userId,
                },
                async function () {
                    context.assertActive()
                    await imported.publish()
                    context.assertActive()
                },
            )
        } catch (error) {
            await imported.dispose().catch(function (cleanupError) {
                context.markCleanupIncomplete()
                logError('backup.import.archive_cleanup_failed', cleanupError)
            })
            normalizeImportError(
                error,
                context,
                new BackupApiError(
                    500,
                    'Das Backup konnte nicht registriert werden.',
                    { cause: error },
                ),
            )
        }
        await publishCommittedAuditLogService(result.auditReceipt)
        await applyBackupRetentionBestEffort(new Set([result.runId]))
        return Response.json({ success: true, runId: result.runId })
    } finally {
        await upload.dispose().catch(function (error) {
            context.markCleanupIncomplete()
            logError('backup.import.upload_cleanup_failed', error)
        })
    }
}

export async function handleBackupImport({ request }: { request: Request }) {
    try {
        assertSameOriginRequest(request)
        await enforceRateLimit({
            ...RATE_LIMITS.backupImport,
            scope: 'backup-import',
        })
        const access = await requirePermissionService(PERMISSIONS.ADMIN_BACKUPS)
        let maximumUploadBytes: number
        try {
            maximumUploadBytes =
                validateBackupUploadRequest(request) ??
                BACKUP_LIMITS.maxArchiveBytes
        } catch (error) {
            throw new BackupApiError(
                400,
                'Es wurde keine gültige Backup-Datei übermittelt.',
                { cause: error },
            )
        }
        const admission = await acquireBackupImportAdmissionService({
            requestSignal: request.signal,
            maximumUploadBytes,
        })
        try {
            return await importAdmittedBackup(request, access.userId, admission)
        } finally {
            await admission.release().catch(function (error) {
                logError('backup.import.admission_cleanup_failed', error)
            })
        }
    } catch (error) {
        return createBackupApiErrorResponse(
            error,
            'backup.import.failed',
            'Das Backup konnte nicht importiert werden.',
        )
    }
}

export const Route = createFileRoute('/api/admin/backups/import')({
    server: {
        handlers: {
            POST: handleBackupImport,
        },
    },
})
