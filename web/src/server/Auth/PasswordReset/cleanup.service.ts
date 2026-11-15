import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { passwordResetTokens, users } from '@/db/schema.ts'
import {
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import type { PreparedAuditContext } from '@/lib/AuditLogs/Types/audit.types.ts'

export async function cleanupPasswordResetTokenService(
    userId: string,
    tokenHash: string,
    auditContext: PreparedAuditContext,
) {
    const receipt = await db.transaction(async function (transaction) {
        const lockedUsers = await transaction
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
            .for('update')
        await transaction
            .delete(passwordResetTokens)
            .where(
                and(
                    eq(passwordResetTokens.userId, userId),
                    eq(passwordResetTokens.tokenHash, tokenHash),
                ),
            )
        return writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            actorUserId:
                auditContext.actorUserId === userId
                    ? (lockedUsers.at(0)?.id ?? null)
                    : null,
            action: 'auth.password_reset_request_cancelled',
            message:
                'Reset-Token wurde nach fehlgeschlagenem Mail-Queueing verworfen.',
            newValues: { targetUserId: userId },
        })
    })
    await publishCommittedAuditLogService(receipt)
}
