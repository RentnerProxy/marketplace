import { createPasswordResetLinkService } from '@/server/Auth/PasswordReset/link.service.ts'
import { and, eq, or } from 'drizzle-orm'
import { db } from '@/db'
import { passwordResetTokens, users } from '@/db/schema.ts'
import { enqueuePasswordResetMail } from '@/server/Queues/mail.queue.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { cleanupPasswordResetTokenService } from '@/server/Auth/PasswordReset/cleanup.service.ts'
import type { RequestPasswordResetInput } from '@/features/Auth/ForgotPassword/Types/forgot-password-server-input.types.ts'
import { logError } from '@/server/Logging/logger.ts'
import { createPasswordResetTokenService } from '@/server/Auth/PasswordReset/token.service.ts'

export async function requestPasswordResetService(
    data: RequestPasswordResetInput,
) {
    const identifier = data.email.trim()
    const emailIdentifier = identifier.toLowerCase()

    const foundUsers = await db
        .select()
        .from(users)
        .where(
            and(
                eq(users.isDeleted, false),
                eq(users.isActive, true),
                or(
                    eq(users.email, emailIdentifier),
                    eq(users.username, identifier),
                ),
            ),
        )
        .limit(1)

    const user = foundUsers.at(0)

    if (!user) {
        return { success: true as const }
    }

    const { token, tokenHash, expiresAt } =
        await createPasswordResetTokenService()

    const auditContext = prepareAuditContextService(null)
    const lockedUser = await db.transaction(async function (transaction) {
        const lockedUsers = await transaction
            .select({
                id: users.id,
                email: users.email,
                username: users.username,
            })
            .from(users)
            .where(
                and(
                    eq(users.id, user.id),
                    eq(users.isActive, true),
                    eq(users.isDeleted, false),
                    or(
                        eq(users.email, emailIdentifier),
                        eq(users.username, identifier),
                    ),
                ),
            )
            .limit(1)
            .for('update')
        const currentUser = lockedUsers.at(0)

        if (!currentUser) {
            return null
        }

        await transaction
            .delete(passwordResetTokens)
            .where(eq(passwordResetTokens.userId, currentUser.id))

        await transaction.insert(passwordResetTokens).values({
            userId: currentUser.id,
            tokenHash,
            expiresAt,
        })

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'auth.password_reset_requested',
                message: `Password-Reset für ${currentUser.username} wurde angefragt.`,
                newValues: { targetUserId: currentUser.id },
            },
        )
        return { ...currentUser, auditReceipt }
    })

    if (!lockedUser) {
        return { success: true as const }
    }

    await publishCommittedAuditLogService(lockedUser.auditReceipt)

    const origin = process.env.ORIGIN?.trim() || 'http://localhost:3000'
    const resetLink = createPasswordResetLinkService(origin, token)

    try {
        await enqueuePasswordResetMail({
            to: lockedUser.email,
            username: lockedUser.username,
            resetLink,
        })
    } catch (error) {
        logError('auth.password_reset.enqueue_failed', error, {
            userId: lockedUser.id,
        })

        try {
            await cleanupPasswordResetTokenService(
                lockedUser.id,
                tokenHash,
                auditContext,
            )
        } catch (cleanupError) {
            logError('auth.password_reset.cleanup_failed', cleanupError, {
                userId: lockedUser.id,
            })
        }

        return { success: true as const }
    }

    return {
        success: true as const,
    }
}
