import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { getActiveUserPermissionKeysInTransaction } from '@/server/Auth/transaction-authorization.service.ts'
import { and, count, eq } from 'drizzle-orm'

import { permissions, userPermissions, users } from '@/db/schema.ts'
import { SUPER_USER_PERMISSION } from '@/lib/Permissions/permissions.ts'

export function getAddedPermissionKeys(
    previousPermissionKeys: Array<string>,
    permissionKeys: Array<string>,
) {
    const previousPermissionKeySet = new Set(previousPermissionKeys)

    return permissionKeys.filter(
        (permissionKey) => !previousPermissionKeySet.has(permissionKey),
    )
}

export function getRemovedPermissionKeys(
    previousPermissionKeys: Array<string>,
    permissionKeys: Array<string>,
) {
    const permissionKeySet = new Set(permissionKeys)

    return previousPermissionKeys.filter(
        (permissionKey) => !permissionKeySet.has(permissionKey),
    )
}

export async function lockAndCountActiveSuperUsers(
    transaction: DatabaseTransaction,
) {
    const superUserPermissions = await transaction
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.key, SUPER_USER_PERMISSION))
        .limit(1)
        .for('update')
    const superUserPermission = superUserPermissions.at(0)

    if (!superUserPermission) {
        return 0
    }

    const activeSuperUserRows = await transaction
        .select({ value: count() })
        .from(userPermissions)
        .innerJoin(users, eq(users.id, userPermissions.userId))
        .where(
            and(
                eq(userPermissions.permissionId, superUserPermission.id),
                eq(users.isActive, true),
                eq(users.isDeleted, false),
            ),
        )

    return activeSuperUserRows.at(0)?.value ?? 0
}

export async function getUserPermissionPolicyContextInTransaction(
    transaction: DatabaseTransaction,
    targetUserId: string,
    currentUserId: string | null,
) {
    const targetPermissionKeys = await getUserPermissionKeys(
        targetUserId,
        transaction,
    )
    const activeSuperUserCount = await lockAndCountActiveSuperUsers(transaction)
    const currentUserPermissionKeys =
        await getActiveUserPermissionKeysInTransaction(
            transaction,
            currentUserId,
        )

    return {
        targetPermissionKeys,
        activeSuperUserCount,
        currentUserPermissionKeys,
    }
}
