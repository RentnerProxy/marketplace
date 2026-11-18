import { normalizePermissionKeys } from '@/lib/Permissions/permissionCollections.ts'
import { lockAccountUniquenessInTransactionService } from '@/server/Auth/accountUniqueness.service.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type { NormalizedUserUpdate } from './Types/user-update.types.ts'
import { writeAuditLogInTransactionService } from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import type { PreparedAuditContext } from '@/lib/AuditLogs/Types/audit.types.ts'
import { getAccountManagementPermission } from '@/lib/UserManagement/accountManagementPermission.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { getUserPermissionPolicyContextInTransaction } from './permissionContext.service.ts'

import {
    evaluateUserUpdatePermissionPolicy,
    USER_MANAGEMENT_PERMISSION_ERROR,
} from './permissionPolicy.service.ts'

import {
    hasDuplicateVisibleUserInTransaction,
    loadSelectedPermissionsInTransaction,
    loadUserProfileInTransaction,
    lockUserForUpdateInTransaction,
    revokeUserAuthenticationStateInTransaction,
    writeUserAndProfileInTransaction,
} from './updatePersistence.service.ts'

export async function updateUserInTransaction(
    transaction: DatabaseTransaction,
    input: NormalizedUserUpdate,
    auditContext: PreparedAuditContext,
) {
    const currentUserId = auditContext.actorUserId
    await lockAccountUniquenessInTransactionService(transaction)
    await lockAuditUsersInTransactionService(transaction, [
        currentUserId,
        input.id,
    ])
    const previousUserData = await lockUserForUpdateInTransaction(
        transaction,
        input.id,
        input.accountType,
    )

    if (!previousUserData || previousUserData.isDeleted) {
        return {
            success: false as const,
            error: 'Benutzer wurde nicht gefunden.',
        }
    }

    const previousProfile = await loadUserProfileInTransaction(
        transaction,
        input.id,
    )
    const previousUser = {
        ...previousUserData,
        ...previousProfile,
    }
    const {
        targetPermissionKeys: previousPermissionKeys,
        activeSuperUserCount,
        currentUserPermissionKeys,
    } = await getUserPermissionPolicyContextInTransaction(
        transaction,
        input.id,
        currentUserId,
    )

    if (
        !currentUserPermissionKeys ||
        !hasPermission(
            currentUserPermissionKeys,
            getAccountManagementPermission(input.accountType),
        )
    ) {
        return {
            success: false as const,
            error: USER_MANAGEMENT_PERMISSION_ERROR,
        }
    }

    const permissionKeys = normalizePermissionKeys(previousPermissionKeys)
    const selectedPermissions = await loadSelectedPermissionsInTransaction(
        transaction,
        permissionKeys,
    )
    const permissionPolicy = evaluateUserUpdatePermissionPolicy({
        currentUserPermissionKeys,
        previousPermissionKeys,
        permissionKeys,
        availablePermissionKeys: selectedPermissions.map(
            (permission) => permission.key,
        ),
        targetUserIsActive: previousUser.isActive,
        activeSuperUserCount,
    })

    if (!permissionPolicy.success) {
        return permissionPolicy
    }

    if (await hasDuplicateVisibleUserInTransaction(transaction, input)) {
        return {
            success: false as const,
            error: 'Username oder E-Mail wird bereits verwendet.',
        }
    }

    const emailChanged = previousUser.email.toLowerCase() !== input.email
    const updatedState = await writeUserAndProfileInTransaction(
        transaction,
        input,
        emailChanged,
    )

    if (!updatedState) {
        return {
            success: false as const,
            error: 'Benutzer wurde nicht gefunden.',
        }
    }

    if (emailChanged) {
        await revokeUserAuthenticationStateInTransaction(transaction, input.id)
    }

    const audit = await writeAuditLogInTransactionService(transaction, {
        ...auditContext,
        action: 'admin.user.updated',
        message: `Benutzer ${updatedState.user.username} wurde aktualisiert.`,
        oldValues: { ...previousUser, permissionKeys: previousPermissionKeys },
        newValues: {
            username: updatedState.user.username,
            email: updatedState.user.email,
            ...updatedState.userProfile,
            permissionKeys,
        },
    })

    return {
        success: true as const,
        audit,
        ...updatedState,
        previousUser,
        previousPermissionKeys,
        permissionKeys,
    }
}
