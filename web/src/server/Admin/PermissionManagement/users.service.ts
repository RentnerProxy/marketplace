import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
    permissions,
    userPermissions,
    user_profiles,
    users,
} from '@/db/schema.ts'
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
            firstName: user_profiles.firstName,
            lastName: user_profiles.lastName,
            isActive: users.isActive,
        })
        .from(users)
        .leftJoin(user_profiles, eq(user_profiles.userId, users.id))
        .where(eq(users.isDeleted, false))
        .orderBy(desc(users.createdAt), asc(users.id))
    const permissionRows = userRows.length
        ? await db
              .select({
                  userId: userPermissions.userId,
                  key: permissions.key,
              })
              .from(userPermissions)
              .innerJoin(
                  permissions,
                  eq(permissions.id, userPermissions.permissionId),
              )
              .innerJoin(users, eq(users.id, userPermissions.userId))
              .where(
                  and(
                      eq(users.isDeleted, false),
                      inArray(permissions.key, configuredPermissionKeys),
                  ),
              )
              .orderBy(asc(userPermissions.userId), asc(permissions.key))
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
            firstName: user.firstName,
            lastName: user.lastName,
            isActive: user.isActive,
            isSuperUser: hasSuperUserPermission(permissionKeys),
            isCurrentUser: user.id === actorUserId,
            permissions: permissionKeys,
        }
    })
}
