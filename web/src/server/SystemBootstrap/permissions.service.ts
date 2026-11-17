import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type {
    SyncedPermission,
    SyncDefaultPermissionsOptions,
} from './Types/bootstrap-permissions.types.ts'

import { eq, notInArray } from 'drizzle-orm'
import { permissions, staffUserPermissions } from '@/db/schema.ts'
import {
    DEFAULT_ADMIN_PERMISSION_KEYS,
    DEFAULT_PERMISSIONS,
    PERMISSIONS,
} from '@/config/permissions.config.ts'
import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'

export async function syncDefaultPermissions(
    transaction: DatabaseTransaction,
    options: SyncDefaultPermissionsOptions = {},
) {
    const availablePermissions: Array<SyncedPermission> = []

    await forEachSequentially(DEFAULT_PERMISSIONS, async function (permission) {
        const rows = await transaction
            .insert(permissions)
            .values(permission)
            .onConflictDoUpdate({
                target: permissions.key,
                set: {
                    name: permission.name,
                    description: permission.description,
                },
            })
            .returning({ id: permissions.id, key: permissions.key })
        const availablePermission = rows.at(0)

        if (!availablePermission) {
            throw new Error(
                `Berechtigung ${permission.key} konnte nicht synchronisiert werden.`,
            )
        }

        availablePermissions.push(availablePermission)
    })

    let grantedAssignments = 0

    if (options.grantAdminPermissionsToSuperUsers) {
        const superUserPermission = availablePermissions.find(
            (permission) => permission.key === PERMISSIONS.ADMIN_SUPER_USER,
        )
        const adminPermissions = availablePermissions.filter((permission) =>
            DEFAULT_ADMIN_PERMISSION_KEYS.includes(permission.key),
        )

        if (superUserPermission) {
            const superUsers = await transaction
                .select({ userId: staffUserPermissions.userId })
                .from(staffUserPermissions)
                .where(
                    eq(
                        staffUserPermissions.permissionId,
                        superUserPermission.id,
                    ),
                )
            const assignments = superUsers.flatMap((user) =>
                adminPermissions.map((permission) => ({
                    userId: user.userId,
                    permissionId: permission.id,
                })),
            )

            if (assignments.length > 0) {
                const insertedAssignments = await transaction
                    .insert(staffUserPermissions)
                    .values(assignments)
                    .onConflictDoNothing()
                    .returning({ userId: staffUserPermissions.userId })
                grantedAssignments = insertedAssignments.length
            }
        }
    }

    let removedPermissions = 0

    if (options.prune) {
        const removed = await transaction
            .delete(permissions)
            .where(
                notInArray(
                    permissions.key,
                    DEFAULT_PERMISSIONS.map((permission) => permission.key),
                ),
            )
            .returning({ id: permissions.id })
        removedPermissions = removed.length
    }

    return {
        permissions: availablePermissions,
        syncedPermissions: availablePermissions.length,
        grantedAssignments,
        removedPermissions,
    }
}
