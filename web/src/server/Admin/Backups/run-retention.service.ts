import { requireMutationPermissionService } from '@/server/Auth/transaction-authorization.service.ts'
import { publishAdminBackupsChangedService } from '@/server/Realtime/publish.service.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { BackupDeletionActor } from './Types/backup-run.types.ts'
import type { AuditReceipt } from '@/lib/AuditLogs/Types/audit.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { backupRuns } from '@/db/schema.ts'
import { logError } from '@/server/Logging/logger.ts'
import { deleteBackupFilesService } from './backup-files.service.ts'
import {
    getOrCreateBackupSettings,
    serializeBackupSettings,
} from './settings.service.ts'
import { getBackupRunById } from './run-registry.service.ts'
import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'

export async function deleteBackupService(backupId: string, userId: string) {
    return deleteBackupWithActorService(backupId, { kind: 'user', userId })
}

async function deleteBackupWithActorService(
    backupId: string,
    actor: BackupDeletionActor,
) {
    const candidate = await getBackupRunById(backupId)
    if (!candidate) {
        throw new Error('Das Backup kann aktuell nicht gelöscht werden.')
    }
    await deleteBackupReferencesService([backupId], candidate.fileName, actor)
    return { success: true as const }
}

function isBackupFileName(fileName: string) {
    return (
        fileName !== '.' &&
        fileName !== '..' &&
        fileName.length <= 255 &&
        /^[a-zA-Z0-9._-]+$/.test(fileName)
    )
}

async function deleteBackupReferencesService(
    backupIds: string[],
    fileName: string | null,
    actor: BackupDeletionActor,
    protectedRunIds: ReadonlySet<string> = new Set(),
) {
    const userId = actor.kind === 'user' ? actor.userId : null
    const auditContext = prepareAuditContextService(
        userId,
        userId ? undefined : { route: null, method: 'WORKER' },
    )
    const auditReceipts = await db.transaction(async function (transaction) {
        if (actor.kind === 'user') {
            await requireMutationPermissionService(
                transaction,
                actor.userId,
                PERMISSIONS.ADMIN_BACKUPS,
            )
        }
        // Row locks alone cannot prevent a new reference INSERT. Acquire this
        // after actor locks and before backup row locks, matching other writers.
        // EXCLUSIVE also blocks SELECT FOR UPDATE, avoiding a row/table upgrade
        // deadlock with restore enqueue while ordinary reads remain available.
        await transaction.execute(
            sql`lock table ${backupRuns} in exclusive mode`,
        )
        const referencedRuns = fileName
            ? await transaction
                  .select()
                  .from(backupRuns)
                  .where(eq(backupRuns.fileName, fileName))
                  .orderBy(backupRuns.id)
                  .for('update')
            : await transaction
                  .select()
                  .from(backupRuns)
                  .where(eq(backupRuns.id, backupIds[0]))
                  .orderBy(backupRuns.id)
                  .for('update')
        const selectedIds = new Set(backupIds)
        const selectedRuns = referencedRuns.filter((run) =>
            selectedIds.has(run.id),
        )
        if (
            (fileName !== null &&
                fileName !== '' &&
                !isBackupFileName(fileName)) ||
            selectedRuns.length !== selectedIds.size ||
            selectedRuns.some(
                (run) =>
                    run.fileName !== fileName ||
                    protectedRunIds.has(run.id) ||
                    run.status === 'running' ||
                    run.status === 'queued' ||
                    (actor.kind === 'retention' && run.status !== 'completed'),
            )
        ) {
            if (actor.kind === 'retention') return []
            throw new Error('Das Backup kann aktuell nicht gelöscht werden.')
        }

        const receipts: AuditReceipt[] = []
        await forEachSequentially(selectedRuns, async function (run) {
            await transaction
                .delete(backupRuns)
                .where(eq(backupRuns.id, run.id))
            receipts.push(
                await writeAuditLogInTransactionService(transaction, {
                    ...auditContext,
                    action: 'admin.backups.deleted',
                    message: 'Backup wurde gelöscht.',
                    oldValues: { backupId: run.id },
                }),
            )
        })

        if (fileName && selectedRuns.length === referencedRuns.length) {
            // Exactly one physical file per transaction. A later commit failure
            // still cannot roll back this unlink; never amplify it across files.
            await deleteBackupFilesService([fileName])
        }
        return receipts
    })

    await forEachSequentially(auditReceipts, publishCommittedAuditLogService)
    if (auditReceipts.length > 0) await publishAdminBackupsChangedService()
}

async function applyBackupRetention(
    protectedRunIds: ReadonlySet<string> = new Set(),
) {
    const settings = serializeBackupSettings(await getOrCreateBackupSettings())
    const completedRuns = await db
        .select()
        .from(backupRuns)
        .where(
            and(
                eq(backupRuns.status, 'completed'),
                isNotNull(backupRuns.fileName),
            ),
        )
        .orderBy(desc(backupRuns.startedAt))
    const usesDays = ['days', 'both'].includes(settings.retentionMode)
    const usesCount = ['count', 'both'].includes(settings.retentionMode)
    const retentionCutoff = usesDays
        ? new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1_000)
        : null
    const expiredIds = new Set([
        ...(usesCount
            ? completedRuns.slice(settings.retentionCount).map((run) => run.id)
            : []),
        ...(retentionCutoff
            ? completedRuns
                  .filter(
                      (run) =>
                          run.startedAt.getTime() < retentionCutoff.getTime(),
                  )
                  .map((run) => run.id)
            : []),
    ])

    const expiredRuns = completedRuns.filter(
        (run) =>
            expiredIds.has(run.id) &&
            !protectedRunIds.has(run.id) &&
            Boolean(run.fileName),
    )

    const groups = new Map<string, string[]>()
    for (const run of expiredRuns) {
        if (!run.fileName || !isBackupFileName(run.fileName)) continue
        const ids = groups.get(run.fileName) ?? []
        ids.push(run.id)
        groups.set(run.fileName, ids)
    }
    await forEachSequentially([...groups], async function ([fileName, ids]) {
        await deleteBackupReferencesService(
            ids,
            fileName,
            { kind: 'retention' },
            protectedRunIds,
        )
    })
}

export async function applyBackupRetentionBestEffort(
    protectedRunIds: ReadonlySet<string> = new Set(),
) {
    try {
        await applyBackupRetention(protectedRunIds)
    } catch (error) {
        logError('backup.retention.failed', error)
    }
}
