import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema.ts'
import type { ReplaceManagedUserPermissionsInput } from '@/features/Admin/PermissionManagement/Types/permission-management-server-input.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import { hasSuperUserPermission } from '@/lib/Permissions/permissions.ts'
import {
    createPermissionsAddedNotificationInTransactionService,
    publishCommittedNotificationsService,
} from '@/server/Notifications/update.service.ts'
import {
    getAddedPermissionKeys,
    getRemovedPermissionKeys,
    getUserPermissionPolicyContextInTransaction,
} from '@/server/Admin/UserManagement/permissionContext.service.ts'
import {
    evaluateUserUpdatePermissionPolicy,
    USER_MANAGEMENT_PERMISSION_ERROR,
} from '@/server/Admin/UserManagement/permissionPolicy.service.ts'
import { replaceUserPermissionsInTransaction } from '@/server/Admin/UserManagement/updatePersistence.service.ts'
import { publishUserUpdatedService } from '@/server/Realtime/publish.service.ts'
import { resolvePermissionSelectionInTransaction } from './permission-management-policy.service.ts'
import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'

export async function replaceManagedUserPermissionsService(
    input: ReplaceManagedUserPermissionsInput,
    actorUserId: string,
) {
    const auditContext = prepareAuditContextService(actorUserId)
    const transactionResult = await db.transaction(
        async function (transaction) {
            await lockAuditUsersInTransactionService(transaction, [
                actorUserId,
                input.userId,
            ])
            const targetUserRows = await transaction
                .select({
                    username: users.username,
                    isActive: users.isActive,
                    isDeleted: users.isDeleted,
                })
                .from(users)
                .where(eq(users.id, input.userId))
                .limit(1)
                .for('update')
            const targetUser = targetUserRows.at(0)

            if (!targetUser || targetUser.isDeleted) {
                return {
                    success: false as const,
                    error: 'Benutzer wurde nicht gefunden.',
                }
            }

            const {
                targetPermissionKeys: previousPermissionKeys,
                activeSuperUserCount,
                currentUserPermissionKeys,
            } = await getUserPermissionPolicyContextInTransaction(
                transaction,
                input.userId,
                actorUserId,
            )

            if (
                !currentUserPermissionKeys ||
                !hasSuperUserPermission(currentUserPermissionKeys)
            ) {
                return {
                    success: false as const,
                    error: USER_MANAGEMENT_PERMISSION_ERROR,
                }
            }

            const permissionSelection =
                await resolvePermissionSelectionInTransaction(
                    transaction,
                    input.permissionKeys,
                    { allowSuperUser: true },
                )

            if (!permissionSelection.success) {
                return permissionSelection
            }

            const permissionPolicy = evaluateUserUpdatePermissionPolicy({
                currentUserPermissionKeys,
                previousPermissionKeys,
                permissionKeys: permissionSelection.permissionKeys,
                availablePermissionKeys: permissionSelection.permissions.map(
                    (permission) => permission.key,
                ),
                targetUserIsActive: targetUser.isActive,
                activeSuperUserCount,
            })

            if (!permissionPolicy.success) {
                return permissionPolicy
            }

            if (permissionPolicy.permissionKeysChanged) {
                await replaceUserPermissionsInTransaction(
                    transaction,
                    input.userId,
                    permissionSelection.permissions,
                )
            }

            const addedPermissionKeys = getAddedPermissionKeys(
                previousPermissionKeys,
                permissionSelection.permissionKeys,
            )
            const removedPermissionKeys = getRemovedPermissionKeys(
                previousPermissionKeys,
                permissionSelection.permissionKeys,
            )

            const notification =
                permissionPolicy.permissionKeysChanged &&
                addedPermissionKeys.length > 0
                    ? await createPermissionsAddedNotificationInTransactionService(
                          transaction,
                          input.userId,
                          addedPermissionKeys,
                      )
                    : null
            const audit = permissionPolicy.permissionKeysChanged
                ? await writeAuditLogInTransactionService(transaction, {
                      ...auditContext,
                      action: 'admin.user.permissions.updated',
                      message: `Rechte von Benutzer ${targetUser.username} wurden aktualisiert.`,
                      oldValues: {
                          userId: input.userId,
                          permissionKeys: previousPermissionKeys,
                      },
                      newValues: {
                          userId: input.userId,
                          permissionKeys: permissionSelection.permissionKeys,
                      },
                  })
                : null
            return {
                success: true as const,
                changed: permissionPolicy.permissionKeysChanged,
                audit,
                notification,
                username: targetUser.username,
                previousPermissionKeys,
                permissionKeys: permissionSelection.permissionKeys,
                addedPermissionKeys,
                removedPermissionKeys,
            }
        },
    )

    if (!transactionResult.success) return transactionResult
    const { audit, notification, ...result } = transactionResult
    if (!result.changed) return result

    if (audit) await publishCommittedAuditLogService(audit)
    if (notification) await publishCommittedNotificationsService([notification])

    await runBestEffortSideEffectService(
        'permission_management.user_publish_failed',
        function () {
            return publishUserUpdatedService({
                userId: input.userId,
                username: transactionResult.username,
                previousUsername: transactionResult.username,
                permissionKeys: transactionResult.permissionKeys,
                previousPermissionKeys:
                    transactionResult.previousPermissionKeys,
                addedPermissionKeys: transactionResult.addedPermissionKeys,
                removedPermissionKeys: transactionResult.removedPermissionKeys,
                updatedAt: new Date().toISOString(),
            })
        },
        { actorUserId, targetUserId: input.userId },
    )

    return result
}
