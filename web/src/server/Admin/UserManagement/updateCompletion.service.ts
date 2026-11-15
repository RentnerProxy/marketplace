import type { SuccessfulUserUpdateTransaction } from './Types/user-update.types.ts'
import type { UserManagementUser } from '@/features/Admin/UserManagement/Types/user-management-domain.types.ts'
import { publishCommittedAuditLogService } from '@/lib/AuditLogs/auditLogs.ts'
import { logError } from '@/server/Logging/logger.ts'
import { hasSuperUserPermission } from '@/lib/Permissions/permissions.ts'
import { publishUserUpdatedService } from '@/server/Realtime/publish.service.ts'

function createUpdatedUserProjection(
    transactionResult: SuccessfulUserUpdateTransaction,
    currentUserId: string | null,
): UserManagementUser {
    const { user, userProfile, permissionKeys } = transactionResult

    return {
        ...user,
        firstName: userProfile.firstName,
        lastName: userProfile.lastName,
        street: userProfile.street,
        houseNumber: userProfile.houseNumber,
        postalCode: userProfile.postalCode,
        city: userProfile.city,
        isDefaultUser: user.createdByUserId === null,
        isSuperUser: hasSuperUserPermission(permissionKeys),
        isCurrentUser: user.id === currentUserId,
        permissions: permissionKeys,
        profileImageVersion:
            userProfile.profileImageUpdatedAt?.getTime() ?? null,
        createdAt: user.createdAt.toISOString(),
    }
}

export async function completeUserUpdateService(
    transactionResult: SuccessfulUserUpdateTransaction,
    currentUserId: string | null,
) {
    const { user, previousUser, previousPermissionKeys, permissionKeys } =
        transactionResult
    await publishCommittedAuditLogService(transactionResult.audit)

    try {
        await publishUserUpdatedService({
            userId: user.id,
            username: user.username,
            previousUsername: previousUser.username,
            permissionKeys,
            previousPermissionKeys,
            addedPermissionKeys: [],
            removedPermissionKeys: [],
            updatedAt: new Date().toISOString(),
        })
    } catch (error) {
        logError('user_management.update_publish_failed', error, {
            userId: user.id,
        })
    }

    return createUpdatedUserProjection(transactionResult, currentUserId)
}
