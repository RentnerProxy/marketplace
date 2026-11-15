import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { normalizePermissionKeys } from '@/lib/Permissions/permissionCollections.ts'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import { permissions, userPermissions, users } from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hasSuperUserPermission } from '@/lib/Permissions/permissions.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { getActiveUserPermissionKeysInTransaction } from '@/server/Auth/transaction-authorization.service.ts'
import { lockAndCountActiveSuperUsers } from '@/server/Admin/UserManagement/permissionContext.service.ts'

import { loadSelectedPermissionsInTransaction } from '@/server/Admin/UserManagement/updatePersistence.service.ts'

export const PERMISSION_MANAGEMENT_PERMISSION_ERROR =
    'Dir fehlt die erforderliche Berechtigung.'
export const UNKNOWN_PERMISSION_ERROR =
    'Mindestens eine angegebene Berechtigung ist unbekannt.'
export const AUTOMATIC_SUPER_USER_PERMISSION_ERROR =
    'Das Superuser-Recht darf nicht automatisch vergeben werden.'

const configuredPermissionKeys = new Set<string>(Object.values(PERMISSIONS))

export async function requireSuperUserReadAccessService(actorUserId: string) {
    const actorRows = await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(userPermissions, eq(userPermissions.userId, users.id))
        .innerJoin(
            permissions,
            eq(permissions.id, userPermissions.permissionId),
        )
        .where(
            and(
                eq(users.id, actorUserId),
                eq(users.isActive, true),
                eq(users.isDeleted, false),
                eq(permissions.key, PERMISSIONS.ADMIN_SUPER_USER),
            ),
        )
        .limit(1)

    if (actorRows.length === 0) {
        throw new PermissionDeniedError()
    }
}

export async function hasSuperUserMutationAccessInTransaction(
    transaction: DatabaseTransaction,
    actorUserId: string,
) {
    await lockAuditUsersInTransactionService(transaction, [actorUserId])
    await lockAndCountActiveSuperUsers(transaction)
    const actorPermissionKeys = await getActiveUserPermissionKeysInTransaction(
        transaction,
        actorUserId,
    )

    return Boolean(
        actorPermissionKeys && hasSuperUserPermission(actorPermissionKeys),
    )
}

export async function resolvePermissionSelectionInTransaction(
    transaction: DatabaseTransaction,
    permissionKeys: Array<string>,
    options: { allowSuperUser: boolean },
) {
    const normalizedPermissionKeys = normalizePermissionKeys(permissionKeys)

    if (
        normalizedPermissionKeys.some(
            (permissionKey) => !configuredPermissionKeys.has(permissionKey),
        )
    ) {
        return {
            success: false as const,
            error: UNKNOWN_PERMISSION_ERROR,
        }
    }

    if (
        !options.allowSuperUser &&
        normalizedPermissionKeys.includes(PERMISSIONS.ADMIN_SUPER_USER)
    ) {
        return {
            success: false as const,
            error: AUTOMATIC_SUPER_USER_PERMISSION_ERROR,
        }
    }

    const selectedPermissions = await loadSelectedPermissionsInTransaction(
        transaction,
        normalizedPermissionKeys,
    )

    if (selectedPermissions.length !== normalizedPermissionKeys.length) {
        return {
            success: false as const,
            error: UNKNOWN_PERMISSION_ERROR,
        }
    }

    const selectedPermissionByKey = new Map(
        selectedPermissions.map((permission) => [permission.key, permission]),
    )

    return {
        success: true as const,
        permissionKeys: normalizedPermissionKeys,
        permissions: normalizedPermissionKeys.map(function (permissionKey) {
            const permission = selectedPermissionByKey.get(permissionKey)

            if (!permission) {
                throw new Error(
                    `Berechtigung ${permissionKey} konnte nicht aufgelöst werden.`,
                )
            }

            return permission
        }),
    }
}
