import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
    passkeyChallenges,
    publicAccounts,
    publicUserPermissions,
    staffAccounts,
    staffInvitations,
    staffUserPermissions,
    users,
} from '@/db/schema.ts'
import type { ConvertAccountTypeInput } from '@/features/Admin/UserManagement/Types/user-management-server-input.types.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import { hasSuperUserPermission } from '@/lib/Permissions/permissions.ts'
import { canConvertAccountType } from '@/lib/UserManagement/accountManagementPermission.ts'
import { lockAccountUniquenessInTransactionService } from '@/server/Auth/accountUniqueness.service.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { getDefaultPublicPermissionsInTransactionService } from '@/server/Auth/publicAccountPermissions.service.ts'
import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'
import {
    publishUserAccountConvertedService,
    publishUserSessionsRevokedService,
} from '@/server/Realtime/publish.service.ts'
import { getUserPermissionPolicyContextInTransaction } from './permissionContext.service.ts'
import { removesLastActiveSuperUser } from './permissionPolicy.service.ts'
import {
    loadSelectedPermissionsInTransaction,
    lockUserForUpdateInTransaction,
    revokeUserAuthenticationStateInTransaction,
} from './updatePersistence.service.ts'

export async function convertAccountTypeService(
    input: ConvertAccountTypeInput,
    actorUserId: string,
) {
    const { accountType } = input
    const id = input.id.toLowerCase()
    const auditContext = prepareAuditContextService(actorUserId)
    const nextAccountType = accountType === 'public' ? 'staff' : 'public'
    const result = await db.transaction(async (transaction) => {
        await lockAccountUniquenessInTransactionService(transaction)
        await lockAuditUsersInTransactionService(transaction, [actorUserId, id])

        const {
            currentUserPermissionKeys,
            targetPermissionKeys,
            activeSuperUserCount,
        } = await getUserPermissionPolicyContextInTransaction(
            transaction,
            id,
            actorUserId,
        )
        if (
            !currentUserPermissionKeys ||
            !canConvertAccountType(currentUserPermissionKeys, accountType) ||
            (hasSuperUserPermission(targetPermissionKeys) &&
                !hasSuperUserPermission(currentUserPermissionKeys))
        ) {
            throw new PermissionDeniedError()
        }
        if (id === actorUserId.toLowerCase()) {
            return { success: false as const, error: 'self' as const }
        }

        const target = await lockUserForUpdateInTransaction(
            transaction,
            id,
            accountType,
        )
        if (!target || target.isDeleted) {
            return { success: false as const, error: 'notFound' as const }
        }

        const nextPermissions =
            nextAccountType === 'public'
                ? await getDefaultPublicPermissionsInTransactionService(
                      transaction,
                  )
                : await loadSelectedPermissionsInTransaction(
                      transaction,
                      targetPermissionKeys,
                  )
        const nextPermissionKeys = nextPermissions.map(({ key }) => key)
        if (
            removesLastActiveSuperUser({
                targetUserIsActive: target.isActive,
                targetUserWillBeActive: target.isActive,
                previousPermissionKeys: targetPermissionKeys,
                nextPermissionKeys,
                activeSuperUserCount,
            })
        ) {
            return { success: false as const, error: 'lastSuperUser' as const }
        }

        if (accountType === 'staff') {
            await transaction
                .update(staffInvitations)
                .set({ isActive: false })
                .where(eq(staffInvitations.invitedByUserId, id))
            await transaction
                .delete(staffAccounts)
                .where(eq(staffAccounts.userId, id))
        } else {
            await transaction
                .delete(publicAccounts)
                .where(eq(publicAccounts.userId, id))
        }
        await transaction
            .update(users)
            .set({ accountType: nextAccountType })
            .where(eq(users.id, id))

        const nextAccounts =
            nextAccountType === 'staff' ? staffAccounts : publicAccounts
        const nextAssignments =
            nextAccountType === 'staff'
                ? staffUserPermissions
                : publicUserPermissions
        await transaction.insert(nextAccounts).values({ userId: id })
        if (nextPermissions.length > 0) {
            await transaction.insert(nextAssignments).values(
                nextPermissions.map(({ id: permissionId }) => ({
                    userId: id,
                    permissionId,
                })),
            )
        }

        await revokeUserAuthenticationStateInTransaction(transaction, id)
        await transaction
            .delete(passkeyChallenges)
            .where(eq(passkeyChallenges.userId, id))

        const audit = await writeAuditLogInTransactionService(transaction, {
            ...auditContext,
            action: 'admin.user.account_type_changed',
            message: `Der Kontotyp von ${target.username} wurde geändert.`,
            oldValues: {
                userId: id,
                accountType,
                permissionKeys: targetPermissionKeys,
            },
            newValues: {
                userId: id,
                accountType: nextAccountType,
                permissionKeys: nextPermissionKeys,
            },
        })
        return { success: true as const, username: target.username, audit }
    })

    if (!result.success) return result
    await publishCommittedAuditLogService(result.audit)
    const updatedAt = new Date().toISOString()
    await Promise.all([
        runBestEffortSideEffectService(
            'user_management.conversion_sessions_publish_failed',
            () =>
                publishUserSessionsRevokedService({
                    userId: id,
                    revokedAt: updatedAt,
                }),
        ),
        runBestEffortSideEffectService(
            'user_management.conversion_publish_failed',
            () =>
                publishUserAccountConvertedService({
                    userId: id,
                    username: result.username,
                    updatedAt,
                }),
        ),
    ])
    return { success: true as const }
}
