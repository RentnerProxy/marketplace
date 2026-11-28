import type { CreateRunInput } from '@/server/Admin/Backups/Types/backup-run.types.ts'
import { publishAdminBackupsChangedService } from '@/server/Realtime/publish.service.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import type { BackupRunWriteExecutor } from './Types/backup-service.types.ts'
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import { BACKUP_TARGET_KEY } from '@/config/backup.config.ts'
import { db } from '@/db'
import { backupRuns } from '@/db/schema.ts'

import {
    BACKUP_FAILURE_MESSAGE,
    getStoredBackupErrorMessageService,
} from './backup.errors.ts'

export async function createRun(
    input: CreateRunInput,
    executor: BackupRunWriteExecutor = db,
) {
    const rows = await executor
        .insert(backupRuns)
        .values({
            id: input.id,
            trigger: input.trigger,
            status: input.status ?? 'queued',
            targetKey: BACKUP_TARGET_KEY,
            includesStorage: input.includesStorage,
            createdByUserId: input.createdByUserId,
            fileName: input.fileName,
            fileSize: input.fileSize,
            checksumSha256: input.checksumSha256,
            completedAt: input.status === 'completed' ? new Date() : undefined,
        })
        .returning({ id: backupRuns.id })

    const createdRun = rows.at(0)

    if (!createdRun) {
        throw new Error('Der Backup-Lauf konnte nicht angelegt werden.')
    }

    return createdRun.id
}

export async function getBackupRunById(backupId: string) {
    const rows = await db
        .select()
        .from(backupRuns)
        .where(eq(backupRuns.id, backupId))
        .limit(1)
    return rows.at(0) ?? null
}

export async function getActiveCreateBackupRun() {
    const rows = await db
        .select()
        .from(backupRuns)
        .where(
            and(
                inArray(backupRuns.trigger, ['manual', 'scheduled']),
                inArray(backupRuns.status, ['queued', 'running']),
            ),
        )
        .orderBy(desc(backupRuns.startedAt))
        .limit(1)
    return rows.at(0) ?? null
}

export async function persistBackupRunAfterRestore(
    run: typeof backupRuns.$inferSelect,
) {
    const values = {
        ...run,
        errorMessage: getStoredBackupErrorMessageService(run.errorMessage),
        createdByUserId: null,
    }

    await db
        .insert(backupRuns)
        .values(values)
        .onConflictDoUpdate({
            target: backupRuns.id,
            set: {
                trigger: values.trigger,
                status: values.status,
                targetKey: values.targetKey,
                fileName: values.fileName,
                fileSize: values.fileSize,
                checksumSha256: values.checksumSha256,
                includesStorage: values.includesStorage,
                errorMessage: values.errorMessage,
                startedAt: values.startedAt,
                completedAt: values.completedAt,
                createdByUserId: null,
            },
        })
}

export async function markRunAsQueueFailed(
    runId: string,
    _error: unknown,
    actorUserId: string | null = null,
) {
    const auditContext = prepareAuditContextService(
        actorUserId,
        actorUserId ? undefined : { route: null, method: 'WORKER' },
    )
    const auditReceipt = await db.transaction(async function (transaction) {
        await lockAuditUsersInTransactionService(transaction, [actorUserId])
        const updatedRuns = await transaction
            .update(backupRuns)
            .set({
                status: 'failed',
                completedAt: new Date(),
                errorMessage: BACKUP_FAILURE_MESSAGE,
            })
            .where(
                and(
                    eq(backupRuns.id, runId),
                    inArray(backupRuns.status, ['queued', 'running']),
                ),
            )
            .returning({ id: backupRuns.id })

        if (updatedRuns.length === 0) {
            return null
        }

        return writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            action: 'admin.backups.queue_failed',
            message:
                'Ein Backup-Lauf konnte nicht über die Queue ausgeführt werden.',
            newValues: { backupRunId: runId, status: 'failed' },
        })
    })

    if (auditReceipt) {
        await publishCommittedAuditLogService(auditReceipt)
        await publishAdminBackupsChangedService()
    }
}

export async function getStaleActiveBackupRuns(cutoff: Date) {
    return db
        .select({ id: backupRuns.id })
        .from(backupRuns)
        .where(
            and(
                inArray(backupRuns.status, ['queued', 'running']),
                lte(backupRuns.startedAt, cutoff),
            ),
        )
}
