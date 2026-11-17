import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
    passwordResetTokens,
    publicUserPermissions,
    sessions,
    socialAccounts,
    trustedDevices,
    twoFactorAuth,
    staffUserPermissions,
    users,
} from '@/db/schema.ts'
import { getAccountManagementPermission } from '@/lib/UserManagement/accountManagementPermission.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import { logError } from '@/server/Logging/logger.ts'
import {
    hasPermission,
    hasSuperUserPermission,
} from '@/lib/Permissions/permissions.ts'
import { publishUserAccessRevokedService } from '@/server/Realtime/publish.service.ts'
import { getCurrentSessionUserId } from '@/server/Auth/currentSession.ts'
import { createDeletedUserIdentity } from './deletedUserIdentity.service.ts'
import { getUserPermissionPolicyContextInTransaction } from './permissionContext.service.ts'
import { hasOtherVisibleUserInTransaction } from './userVisibility.service.ts'
import {
    LAST_ACTIVE_SUPER_USER_ERROR,
    removesLastActiveSuperUser,
    USER_MANAGEMENT_PERMISSION_ERROR,
} from './permissionPolicy.service.ts'
import type { DeleteUserInput } from '@/features/Admin/UserManagement/Types/user-management-server-input.types.ts'

export async function deleteUserService(data: DeleteUserInput) {
    const currentUserId = await getCurrentSessionUserId()
    const auditContext = prepareAuditContextService(currentUserId)
    const deletedUserIdentity = createDeletedUserIdentity()
    const transactionResult = await db.transaction(
        async function (transaction) {
            await lockAuditUsersInTransactionService(transaction, [
                currentUserId,
                data.id,
            ])
            const deletedUsers = await transaction
                .select({
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
            const deletedUser = deletedUsers.at(0)

            if (!deletedUser || deletedUser.isDeleted) {
                return {
                    success: false as const,
                    error: 'Benutzer wurde nicht gefunden.',
                }
            }

            const {
                targetPermissionKeys: deletedUserPermissionKeys,
                activeSuperUserCount,
                currentUserPermissionKeys,
            } = await getUserPermissionPolicyContextInTransaction(
                transaction,
                data.id,
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

            if (currentUserId === data.id) {
                return {
                    success: false as const,
                    error: 'Du kannst deinen eigenen Benutzer nicht löschen.',
                }
            }

            const deletedUserIsSuperUser = hasSuperUserPermission(
                deletedUserPermissionKeys,
            )

            if (
                deletedUserIsSuperUser &&
                !hasSuperUserPermission(currentUserPermissionKeys)
            ) {
                return {
                    success: false as const,
                    error: 'Nur Superuser dürfen andere Superuser löschen.',
                }
            }

            if (
                removesLastActiveSuperUser({
                    targetUserIsActive: deletedUser.isActive,
                    targetUserWillBeActive: false,
                    previousPermissionKeys: deletedUserPermissionKeys,
                    nextPermissionKeys: [],
                    activeSuperUserCount,
                })
            ) {
                return {
                    success: false as const,
                    error: LAST_ACTIVE_SUPER_USER_ERROR,
                }
            }

            if (
                !(await hasOtherVisibleUserInTransaction(transaction, data.id))
            ) {
                return {
                    success: false as const,
                    error: 'Der letzte Benutzer kann nicht gelöscht werden.',
                }
            }

            await transaction
                .delete(sessions)
                .where(eq(sessions.userId, data.id))
            await transaction
                .delete(passwordResetTokens)
                .where(eq(passwordResetTokens.userId, data.id))
            await transaction
                .delete(trustedDevices)
                .where(eq(trustedDevices.userId, data.id))
            await transaction
                .delete(twoFactorAuth)
                .where(eq(twoFactorAuth.userId, data.id))
            await transaction
                .delete(socialAccounts)
                .where(eq(socialAccounts.userId, data.id))
            const assignments =
                data.accountType === 'staff'
                    ? staffUserPermissions
                    : publicUserPermissions
            await transaction
                .delete(assignments)
                .where(eq(assignments.userId, data.id))
            const updatedUsers = await transaction
                .update(users)
                .set({
                    ...deletedUserIdentity,
                    isActive: false,
                    isDeleted: true,
                    isTwoFactorEnabled: false,
                })
                .where(eq(users.id, data.id))
                .returning({ id: users.id })

            if (updatedUsers.length === 0) {
                throw new Error('Benutzer konnte nicht gelöscht werden.')
            }

            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action: 'admin.user.deleted',
                message: `Benutzer ${deletedUser.username} wurde gelöscht.`,
                oldValues: {
                    id: data.id,
                    ...deletedUser,
                },
                newValues: {
                    id: data.id,
                    username: deletedUserIdentity.username,
                    email: deletedUserIdentity.email,
                    isActive: false,
                    isDeleted: true,
                },
            })

            return { success: true as const, deletedUser, audit }
        },
    )

    if (!transactionResult.success) {
        return transactionResult
    }

    try {
        await publishUserAccessRevokedService(
            {
                userId: data.id,
                reason: 'deleted',
                updatedAt: new Date().toISOString(),
            },
            data.accountType,
        )
    } catch (error) {
        logError('user_management.delete_publish_failed', error, {
            userId: data.id,
        })
    }

    await publishCommittedAuditLogService(transactionResult.audit)

    return { success: true as const }
}
