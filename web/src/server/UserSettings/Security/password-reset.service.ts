import { createPasswordResetLinkService } from '@/server/Auth/PasswordReset/link.service.ts'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { passwordResetTokens, users } from '@/db/schema.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { cleanupPasswordResetTokenService } from '@/server/Auth/PasswordReset/cleanup.service.ts'
import { getCurrentUserSettingsSession } from '@/server/Auth/currentSession.ts'
import { createPasswordResetTokenService } from '@/server/Auth/PasswordReset/token.service.ts'
import { enqueuePasswordResetMail } from '@/server/Queues/mail.queue.ts'

export async function requestCurrentUserPasswordResetService() {
    const currentUser = await getCurrentUserSettingsSession()

    if (!currentUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    const { token, tokenHash, expiresAt } =
        await createPasswordResetTokenService()

    const auditContext = prepareAuditContextService(currentUser.id)
    const resetUser = await db.transaction(async function (transaction) {
        const lockedUsers = await transaction
            .select({
                id: users.id,
                email: users.email,
                username: users.username,
            })
            .from(users)
            .where(
                and(
                    eq(users.id, currentUser.id),
                    eq(users.isActive, true),
                    eq(users.isDeleted, false),
                ),
            )
            .limit(1)
            .for('update')

        if (lockedUsers.length === 0) {
            return null
        }

        const lockedUser = lockedUsers[0]

        await transaction
            .delete(passwordResetTokens)
            .where(eq(passwordResetTokens.userId, lockedUser.id))
        await transaction.insert(passwordResetTokens).values({
            userId: lockedUser.id,
            tokenHash,
            expiresAt,
        })

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'user.password_reset_requested',
                message: 'Password-Reset wurde angefragt.',
            },
        )
        return { ...lockedUser, auditReceipt }
    })

    if (!resetUser) {
        return { success: false as const, error: 'Du bist nicht angemeldet.' }
    }

    await publishCommittedAuditLogService(resetUser.auditReceipt)

    const origin = process.env.ORIGIN ?? 'http://localhost:3000'
    const resetLink = createPasswordResetLinkService(origin, token)

    try {
        await enqueuePasswordResetMail({
            to: resetUser.email,
            username: resetUser.username,
            resetLink,
        })
    } catch {
        await cleanupPasswordResetTokenService(
            resetUser.id,
            tokenHash,
            auditContext,
        )

        return {
            success: false as const,
            error: 'Reset-E-Mail konnte nicht eingeplant werden.',
        }
    }

    return { success: true as const }
}
