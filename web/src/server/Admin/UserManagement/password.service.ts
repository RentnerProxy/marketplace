import { createPasswordResetLinkService } from '@/server/Auth/PasswordReset/link.service.ts'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { passwordResetTokens, users } from '@/db/schema.ts'
import { getAccountManagementPermission } from '@/lib/UserManagement/accountManagementPermission.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import { enqueuePasswordResetMail } from '@/server/Queues/mail.queue.ts'
import {
    hasPermission,
    hasSuperUserPermission,
} from '@/lib/Permissions/permissions.ts'
import { getCurrentSessionUserId } from '@/server/Auth/currentSession.ts'
import { createPasswordResetTokenService } from '@/server/Auth/PasswordReset/token.service.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { getActiveUserPermissionKeysInTransaction } from '@/server/Auth/transaction-authorization.service.ts'
import { USER_MANAGEMENT_PERMISSION_ERROR } from './permissionPolicy.service.ts'
import type { ResetUserPasswordInput } from '@/features/Admin/UserManagement/Types/user-management-server-input.types.ts'

export async function resetUserPasswordService(data: ResetUserPasswordInput) {
    const currentUserId = await getCurrentSessionUserId()
    const auditContext = prepareAuditContextService(currentUserId)
    const { token, tokenHash, expiresAt } =
        await createPasswordResetTokenService()
    const transactionResult = await db.transaction(
        async function (transaction) {
            await lockAuditUsersInTransactionService(transaction, [
                currentUserId,
                data.id,
            ])
            const foundUsers = await transaction
                .select({
                    id: users.id,
                    username: users.username,
                    email: users.email,
                    isActive: users.isActive,
                    isDeleted: users.isDeleted,
                })
                .from(users)
                .where(
                    and(
                        eq(users.id, data.id),
                        eq(users.accountType, data.accountType),
                    ),
                )
                .limit(1)
                .for('update')
            const user = foundUsers.at(0)

            if (!user || user.isDeleted) {
                return {
                    success: false as const,
                    error: 'Benutzer wurde nicht gefunden.',
                }
            }

            if (!user.isActive) {
                return {
                    success: false as const,
                    error: 'Für deaktivierte Benutzer kann kein Passwort-Reset versendet werden.',
                }
            }

            const currentUserPermissionKeys =
                await getActiveUserPermissionKeysInTransaction(
                    transaction,
                    currentUserId,
                )

            if (
                !currentUserPermissionKeys ||
                !hasPermission(
                    currentUserPermissionKeys,
                    getAccountManagementPermission(data.accountType),
                )
            ) {
                return {
                    success: false as const,
                    error: USER_MANAGEMENT_PERMISSION_ERROR,
                }
            }

            const targetUserPermissionKeys = await getUserPermissionKeys(
                data.id,
                transaction,
            )

            if (
                hasSuperUserPermission(targetUserPermissionKeys) &&
                !hasSuperUserPermission(currentUserPermissionKeys)
            ) {
                return {
                    success: false as const,
                    error: 'Nur Superuser dürfen Passwort-Resets für Superuser auslösen.',
                }
            }

            await transaction
                .delete(passwordResetTokens)
                .where(eq(passwordResetTokens.userId, user.id))
            await transaction.insert(passwordResetTokens).values({
                userId: user.id,
                tokenHash,
                expiresAt,
            })

            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action: 'admin.user.password_reset_requested',
                message: `Password-Reset für ${user.username} wurde angefragt.`,
                newValues: { targetUserId: user.id },
            })
            return { success: true as const, user, audit }
        },
    )

    if (!transactionResult.success) {
        return transactionResult
    }

    const { user } = transactionResult

    const origin = process.env.ORIGIN ?? 'http://localhost:3000'
    const resetLink = createPasswordResetLinkService(origin, token)

    try {
        await enqueuePasswordResetMail({
            to: user.email,
            username: user.username,
            resetLink,
        })
    } catch {
        const cancellationAudit = await db.transaction(
            async function (transaction) {
                await lockAuditUsersInTransactionService(transaction, [
                    currentUserId,
                    user.id,
                ])
                const deletedTokens = await transaction
                    .delete(passwordResetTokens)
                    .where(
                        and(
                            eq(passwordResetTokens.userId, user.id),
                            eq(passwordResetTokens.tokenHash, tokenHash),
                        ),
                    )
                    .returning({ userId: passwordResetTokens.userId })
                if (deletedTokens.length === 0) return null
                return writeAuditLogInTransactionService(transaction, {
                    ...auditContext,
                    action: 'admin.user.password_reset_cancelled',
                    message:
                        'Password-Reset wurde nach einem Fehler beim Einplanen der E-Mail zurückgenommen.',
                    newValues: {
                        targetUserId: user.id,
                        requestAuditLogId: transactionResult.audit.id,
                    },
                })
            },
        )
        await publishCommittedAuditLogService(transactionResult.audit)
        if (cancellationAudit)
            await publishCommittedAuditLogService(cancellationAudit)

        return {
            success: false as const,
            error: 'Reset-E-Mail konnte nicht eingeplant werden.',
        }
    }

    await publishCommittedAuditLogService(transactionResult.audit)

    return { success: true as const }
}
