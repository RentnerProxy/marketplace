import type { BackupJobData } from '@/server/Admin/Backups/Types/backup-worker.types.ts'
import { publishAdminBackupsChangedService } from '@/server/Realtime/publish.service.ts'
import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { ExecuteCreateBackupOptions } from './Types/backup-run.types.ts'
import type { AuditReceipt } from '@/lib/AuditLogs/Types/audit.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import { and, eq, inArray } from 'drizzle-orm'
import { rm } from 'node:fs/promises'
import { normalizeError } from '@/lib/Errors/error.ts'
import { db } from '@/db'
import { backupRuns } from '@/db/schema.ts'
import { logError } from '@/server/Logging/logger.ts'
import { createBackupArchive } from './archive-create.service.ts'
import { getBackupFilePath } from './backup-directory.service.ts'
import { getBackupQueue } from './backup.queue.ts'

import {
    getOrCreateBackupSettings,
    serializeBackupSettings,
} from './settings.service.ts'
import { BACKUP_FAILURE_MESSAGE } from './backup.errors.ts'
import {
    createRun,
    getBackupRunById,
    markRunAsQueueFailed,
} from './run-registry.service.ts'
import { applyBackupRetentionBestEffort } from './run-retention.service.ts'
import type { RegisterImportedBackupInput } from './Types/backup-service.types.ts'

export async function createManualBackupForDownloadService(userId: string) {
    const auditContext = prepareAuditContextService(userId, {
        route: '/api/admin/backups/download',
        method: 'POST',
    })
    const result = await db.transaction(async function (transaction) {
        await requireMutationPermissionService(
            transaction,
            userId,
            PERMISSIONS.ADMIN_BACKUPS,
        )
        const settings = serializeBackupSettings(
            await getOrCreateBackupSettings(transaction),
        )
        const runId = await createRun(
            {
                trigger: 'manual',
                includesStorage: settings.includeStorage,
                createdByUserId: userId,
            },
            transaction,
        )
        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'admin.backups.creation_queued',
                message: 'Manuelles Backup wurde zur Erstellung eingeplant.',
                newValues: { backupRunId: runId },
            },
        )
        return { runId, auditReceipt }
    })
    const { runId } = result
    await publishCommittedAuditLogService(result.auditReceipt)

    try {
        await getBackupQueue().add(
            'manual-backup',
            { kind: 'create', runId, trigger: 'manual' },
            { jobId: runId },
        )
    } catch (error) {
        await markRunAsQueueFailed(runId, error, userId)
        throw error
    }

    await publishAdminBackupsChangedService()
    return { success: true as const, runId }
}

export async function registerImportedBackupService(
    input: RegisterImportedBackupInput,
    publishArchive: () => Promise<void>,
) {
    const auditContext = prepareAuditContextService(input.userId, {
        route: '/api/admin/backups/import',
        method: 'POST',
    })

    const result = await db.transaction(async function (transaction) {
        await requireMutationPermissionService(
            transaction,
            input.userId,
            PERMISSIONS.ADMIN_BACKUPS,
        )
        const runId = await createRun(
            {
                trigger: 'import',
                includesStorage: input.includesStorage,
                createdByUserId: input.userId,
                fileName: input.fileName,
                fileSize: input.fileSize,
                checksumSha256: input.checksumSha256,
                status: 'completed',
            },
            transaction,
        )
        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'admin.backups.imported',
                message: 'Backup wurde importiert.',
                newValues: { backupRunId: runId },
            },
        )

        await publishArchive()
        return { runId, auditReceipt }
    })
    await publishAdminBackupsChangedService()
    return result
}

export async function executeCreateBackup(
    job: Extract<BackupJobData, { kind: 'create' }>,
    options: ExecuteCreateBackupOptions = {},
) {
    const settings = serializeBackupSettings(await getOrCreateBackupSettings())
    let existingRun = job.runId ? await getBackupRunById(job.runId) : null

    if (job.runId && !existingRun) {
        if (job.trigger !== 'scheduled') {
            throw new Error('Der zugehörige Backup-Lauf existiert nicht mehr.')
        }

        await createRun({
            id: job.runId,
            trigger: job.trigger,
            includesStorage: settings.includeStorage,
        })
        existingRun = await getBackupRunById(job.runId)
    }

    if (existingRun?.status === 'completed') {
        return existingRun.id
    }

    const executableStatuses = options.deferFailureToQueue
        ? ['queued', 'running', 'failed']
        : ['queued', 'running']

    if (existingRun && !executableStatuses.includes(existingRun.status)) {
        throw new Error(
            'Der zugehörige Backup-Lauf befindet sich nicht in einem ausführbaren Zustand.',
        )
    }

    const includesStorage =
        existingRun?.includesStorage ?? settings.includeStorage
    const runId =
        job.runId ??
        (await createRun({
            trigger: job.trigger,
            includesStorage,
        }))

    const startedRuns = await db
        .update(backupRuns)
        .set({
            status: 'running',
            startedAt: new Date(),
            completedAt: null,
            errorMessage: null,
        })
        .where(
            and(
                eq(backupRuns.id, runId),
                inArray(backupRuns.status, executableStatuses),
            ),
        )
        .returning({ id: backupRuns.id })

    if (startedRuns.length === 0) {
        throw new Error('Der zugehörige Backup-Lauf existiert nicht mehr.')
    }

    await publishAdminBackupsChangedService()

    const completionAuditContext = prepareAuditContextService(
        existingRun?.createdByUserId ?? null,
        { route: null, method: 'WORKER' },
    )
    let archive: Awaited<ReturnType<typeof createBackupArchive>> | undefined
    let completedAuditReceipt: AuditReceipt

    try {
        archive = await createBackupArchive({
            includesStorage,
            onProgress: options.reportProgress,
        })
        const completedArchive = archive
        completedAuditReceipt = await db.transaction(
            async function (transaction) {
                await lockAuditUsersInTransactionService(transaction, [
                    completionAuditContext.actorUserId,
                ])
                const completedRuns = await transaction
                    .update(backupRuns)
                    .set({
                        status: 'completed',
                        completedAt: new Date(),
                        fileName: completedArchive.fileName,
                        fileSize: completedArchive.fileSize,
                        checksumSha256: completedArchive.checksumSha256,
                    })
                    .where(
                        and(
                            eq(backupRuns.id, runId),
                            inArray(backupRuns.status, ['queued', 'running']),
                        ),
                    )
                    .returning({ id: backupRuns.id })

                if (completedRuns.length === 0) {
                    throw normalizeError(
                        new Error(
                            'Der Backup-Lauf ist vor Abschluss aus der Datenbank verschwunden.',
                        ),
                    )
                }
                return writeAuditLogInTransactionService(transaction, {
                    ...completionAuditContext,
                    action: 'admin.backups.created',
                    message:
                        job.trigger === 'manual'
                            ? 'Manuelles Backup wurde erstellt.'
                            : 'Geplantes Backup wurde erstellt.',
                    newValues: { backupRunId: runId },
                })
            },
        )
    } catch (error) {
        if (archive) {
            try {
                await rm(await getBackupFilePath(archive.fileName), {
                    force: true,
                })
            } catch (cleanupError) {
                logError('backup.create.orphan_cleanup_failed', cleanupError, {
                    runId,
                })
            }
        }

        await db
            .update(backupRuns)
            .set({
                status: options.deferFailureToQueue ? 'queued' : 'failed',
                completedAt: options.deferFailureToQueue ? null : new Date(),
                errorMessage: BACKUP_FAILURE_MESSAGE,
            })
            .where(
                and(eq(backupRuns.id, runId), eq(backupRuns.status, 'running')),
            )
        await publishAdminBackupsChangedService()
        throw error
    }

    await publishCommittedAuditLogService(completedAuditReceipt)
    await applyBackupRetentionBestEffort()
    await publishAdminBackupsChangedService()
    return runId
}
