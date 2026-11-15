import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { auditLogs } from '@/db/schema.ts'
import {
    PREFERENCE_AUDIT_ACTIONS,
    PREFERENCE_AUDIT_RETENTION,
} from '@/config/audit.config.ts'
import type { AuditReceipt } from './Types/audit.types.ts'

const preferenceActions = new Set<string>(PREFERENCE_AUDIT_ACTIONS)

export async function prunePreferenceAuditLogsInTransactionService(
    transaction: DatabaseTransaction,
    actorUserId: string | null,
    action: string,
    receipt: AuditReceipt,
): Promise<void> {
    if (actorUserId === null || !preferenceActions.has(action)) return

    const scope = and(
        eq(auditLogs.actorUserId, actorUserId),
        inArray(auditLogs.action, PREFERENCE_AUDIT_ACTIONS),
        ne(auditLogs.id, receipt.id),
    )
    const retainedPreviousRows =
        PREFERENCE_AUDIT_RETENTION.maximumRowsPerActor - 1
    const oldestRows = await transaction
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(scope)
        .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
        .limit(
            retainedPreviousRows +
                PREFERENCE_AUDIT_RETENTION.maximumDeletesPerWrite,
        )
    const deleteCount = Math.min(
        PREFERENCE_AUDIT_RETENTION.maximumDeletesPerWrite,
        oldestRows.length - retainedPreviousRows,
    )
    if (deleteCount <= 0) return

    await transaction.delete(auditLogs).where(
        and(
            scope,
            inArray(
                auditLogs.id,
                oldestRows.slice(0, deleteCount).map((row) => row.id),
            ),
        ),
    )
}
