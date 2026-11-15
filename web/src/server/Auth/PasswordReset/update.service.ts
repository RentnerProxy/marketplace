import { notifyCommittedSecurityChangeService } from '@/server/Auth/security-change-notification.service.ts'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import {
    passwordResetTokens,
    sessions,
    trustedDevices,
    users,
} from '@/db/schema.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import type { UpdatePasswordByTokenInput } from '@/features/Auth/PasswordReset/Types/password-reset-server-input.types.ts'
import { publishUserSessionsRevokedService } from '@/server/Realtime/publish.service.ts'
import { logError, logWarn } from '@/server/Logging/logger.ts'
import { issueLoginRecoveryGrantService } from '@/server/Auth/Login/recovery.service.ts'

export async function updatePasswordByTokenService(
    data: UpdatePasswordByTokenInput,
) {
    const tokenHash = await createTokenHash(data.token)
    const foundTokens = await db
        .select({ userId: passwordResetTokens.userId })
        .from(passwordResetTokens)
        .where(
            and(
                eq(passwordResetTokens.tokenHash, tokenHash),
                gt(passwordResetTokens.expiresAt, new Date()),
            ),
        )
        .limit(1)
    const validToken = foundTokens.at(0)

    if (!validToken) {
        return {
            success: false as const,
            error: 'Ungültiger oder abgelaufener Token.',
        }
    }

    const hashedPassword = await Bun.password.hash(data.password)
    const auditContext = prepareAuditContextService(validToken.userId)
    const resetUser = await db.transaction(async function (transaction) {
        const lockedUsers = await transaction
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
            })
            .from(users)
            .where(
                and(
                    eq(users.id, validToken.userId),
                    eq(users.isActive, true),
                    eq(users.isDeleted, false),
                ),
            )
            .limit(1)
            .for('update')
        const currentUser = lockedUsers.at(0)

        if (!currentUser) {
            return null
        }

        const consumedTokens = await transaction
            .delete(passwordResetTokens)
            .where(
                and(
                    eq(passwordResetTokens.tokenHash, tokenHash),
                    eq(passwordResetTokens.userId, currentUser.id),
                    gt(passwordResetTokens.expiresAt, new Date()),
                ),
            )
            .returning({ userId: passwordResetTokens.userId })
        if (consumedTokens.length === 0) {
            return null
        }
        const userId = currentUser.id

        const updatedUsers = await transaction
            .update(users)
            .set({ passwordHash: hashedPassword })
            .where(
                and(
                    eq(users.id, userId),
                    eq(users.isActive, true),
                    eq(users.isDeleted, false),
                ),
            )
            .returning({ id: users.id })

        if (updatedUsers.length === 0) {
            throw new Error('Password reset user update failed')
        }

        await transaction.delete(sessions).where(eq(sessions.userId, userId))
        await transaction
            .delete(trustedDevices)
            .where(eq(trustedDevices.userId, userId))

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                action: 'auth.password_updated_by_token',
                message: 'Passwort wurde über Reset-Token geändert.',
            },
        )
        return { ...currentUser, auditReceipt }
    })

    if (!resetUser) {
        return {
            success: false as const,
            error: 'Ungültiger oder abgelaufener Token.',
        }
    }

    await notifyCommittedSecurityChangeService({
        to: resetUser.email,
        change: 'password_changed',
        auditReceipt: resetUser.auditReceipt,
    })

    const resetUserId = resetUser.id
    await publishCommittedAuditLogService(resetUser.auditReceipt)

    try {
        await publishUserSessionsRevokedService({
            userId: resetUserId,
            revokedAt: new Date().toISOString(),
        })
    } catch (error) {
        logError('auth.password_reset.realtime_revoke_failed', error, {
            userId: resetUserId,
        })
    }

    try {
        await issueLoginRecoveryGrantService({
            userId: resetUserId,
            username: resetUser.username,
            passwordHash: hashedPassword,
        })
    } catch {
        logWarn('auth.password_reset.recovery_unavailable', {
            userId: resetUserId,
        })
    }

    return { success: true as const }
}
