import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
    passkeyChallenges,
    passwordResetTokens,
    sessions,
    trustedDevices,
    users,
} from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
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
import { getCurrentSessionUserId } from '@/server/Auth/currentSession.ts'
import { publishUserAccessRevokedService } from '@/server/Realtime/publish.service.ts'
import type { SetUserActiveInput } from '@/features/Admin/UserManagement/Types/user-management-server-input.types.ts'
import {
    LAST_ACTIVE_SUPER_USER_ERROR,
    removesLastActiveSuperUser,
    USER_MANAGEMENT_PERMISSION_ERROR,
} from './permissionPolicy.service.ts'
import { getUserPermissionPolicyContextInTransaction } from './permissionContext.service.ts'

export async function setUserActiveService(data: SetUserActiveInput) {
    const currentUserId = await getCurrentSessionUserId()
    const auditContext = prepareAuditContextService(currentUserId)
    const transactionResult = await db.transaction(
        async function (transaction) {
            await lockAuditUsersInTransactionService(transaction, [
                currentUserId,
                data.id,
            ])
            const previousUsers = await transaction
                .select({
                    username: users.username,
                    email: users.email,
                    createdByUserId: users.createdByUserId,
                    isActive: users.isActive,
                    isDeleted: users.isDeleted,
                })
                .from(users)
                .where(eq(users.id, data.id))
                .limit(1)
                .for('update')
            const previousUser = previousUsers.at(0)

            if (!previousUser || previousUser.isDeleted) {
                return {
                    success: false as const,
                    error: 'Benutzer wurde nicht gefunden.',
                }
            }

            const {
                targetPermissionKeys: previousUserPermissionKeys,
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
                    PERMISSIONS.ADMIN_USER_MANAGEMENT,
                )
            ) {
                return {
                    success: false as const,
                    error: USER_MANAGEMENT_PERMISSION_ERROR,
                }
            }

            if (currentUserId === data.id && !data.isActive) {
                return {
                    success: false as const,
                    error: 'Du kannst deinen eigenen Benutzer nicht deaktivieren.',
                }
            }

            const previousUserIsSuperUser = hasSuperUserPermission(
                previousUserPermissionKeys,
            )
            const currentUserIsSuperUser = hasSuperUserPermission(
                currentUserPermissionKeys,
            )

            if (previousUserIsSuperUser && !currentUserIsSuperUser) {
                return {
                    success: false as const,
                    error: 'Nur Superuser dürfen den Status von Superusern ändern.',
                }
            }

            if (
                removesLastActiveSuperUser({
                    targetUserIsActive: previousUser.isActive,
                    targetUserWillBeActive: data.isActive,
                    previousPermissionKeys: previousUserPermissionKeys,
                    nextPermissionKeys: previousUserPermissionKeys,
                    activeSuperUserCount,
                })
            ) {
                return {
                    success: false as const,
                    error: LAST_ACTIVE_SUPER_USER_ERROR,
                }
            }

            const updatedUsers = await transaction
                .update(users)
                .set({ isActive: data.isActive })
                .where(eq(users.id, data.id))
                .returning({ id: users.id })

            if (updatedUsers.length === 0) {
                return {
                    success: false as const,
                    error: 'Benutzer wurde nicht gefunden.',
                }
            }

            if (!data.isActive) {
                await transaction
                    .delete(sessions)
                    .where(eq(sessions.userId, data.id))
                await transaction
                    .delete(trustedDevices)
                    .where(eq(trustedDevices.userId, data.id))
                await transaction
                    .delete(passwordResetTokens)
                    .where(eq(passwordResetTokens.userId, data.id))
                await transaction
                    .delete(passkeyChallenges)
                    .where(eq(passkeyChallenges.userId, data.id))
            }

            const audit = await writeAuditLogInTransactionService(transaction, {
                ...auditContext,
                action: 'admin.user.active_changed',
                message: `Benutzerstatus von ${previousUser.username} wurde auf ${data.isActive ? 'aktiv' : 'deaktiviert'} gesetzt.`,
                oldValues: {
                    isActive: previousUser.isActive,
                },
                newValues: {
                    isActive: data.isActive,
                },
            })

            return { success: true as const, previousUser, audit }
        },
    )

    if (!transactionResult.success) {
        return transactionResult
    }

    if (!data.isActive) {
        try {
            await publishUserAccessRevokedService({
                userId: data.id,
                reason: 'deactivated',
                updatedAt: new Date().toISOString(),
            })
        } catch (error) {
            logError('user_management.active_publish_failed', error, {
                userId: data.id,
            })
        }
    }

    await publishCommittedAuditLogService(transactionResult.audit)

    return { success: true as const }
}
