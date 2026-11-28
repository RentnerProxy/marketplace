import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { permissions, staffUserPermissions, users } from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionManagementUser } from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'
import { hasSuperUserPermission } from '@/lib/Permissions/permissions.ts'
import { requireSuperUserReadAccessService } from './permission-management-policy.service.ts'

const configuredPermissionKeys = Object.values(PERMISSIONS)

export async function getPermissionManagementUsersService(
    actorUserId: string,
): Promise<Array<PermissionManagementUser>> {
    await requireSuperUserReadAccessService(actorUserId)

    const userRows = await db
        .select({
            id: users.id,
            username: users.username,
            email: users.email,
            isActive: users.isActive,
        })
        .from(users)
        .where(and(eq(users.isDeleted, false), eq(users.accountType, 'staff')))
        .orderBy(desc(users.createdAt), asc(users.id))
    const permissionRows = userRows.length
        ? await db
              .select({
                  userId: staffUserPermissions.userId,
                  key: permissions.key,
              })
              .from(staffUserPermissions)
              .innerJoin(
                  permissions,
                  eq(permissions.id, staffUserPermissions.permissionId),
              )
              .innerJoin(users, eq(users.id, staffUserPermissions.userId))
              .where(
                  and(
                      eq(users.isDeleted, false),
                      eq(users.accountType, 'staff'),
                      inArray(permissions.key, configuredPermissionKeys),
                  ),
              )
              .orderBy(asc(staffUserPermissions.userId), asc(permissions.key))
        : []
    const permissionKeysByUserId = new Map<string, Array<string>>()

    for (const permission of permissionRows) {
        const permissionKeys =
            permissionKeysByUserId.get(permission.userId) ?? []
        permissionKeys.push(permission.key)
        permissionKeysByUserId.set(permission.userId, permissionKeys)
    }

    return userRows.map(function (user) {
        const permissionKeys = permissionKeysByUserId.get(user.id) ?? []

        return {
            id: user.id,
            username: user.username,
            email: user.email,
            isActive: user.isActive,
            isSuperUser: hasSuperUserPermission(permissionKeys),
            isCurrentUser: user.id === actorUserId,
            permissions: permissionKeys,
        }
    })
}
