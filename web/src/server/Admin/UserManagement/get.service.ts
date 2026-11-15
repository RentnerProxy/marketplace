import { asc, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
    permissions,
    userPermissions,
    user_profiles,
    users,
} from '@/db/schema.ts'
import {
    getVisiblePermissionKeys,
    hasSuperUserPermission,
    SUPER_USER_PERMISSION,
} from '@/lib/Permissions/permissions.ts'
import { getCurrentUserAccess } from '@/server/Auth/currentSession.ts'

export async function getPermissionsService() {
    const currentUserAccess = await getCurrentUserAccess()
    const permissionRows = await db
        .select({
            id: permissions.id,
            key: permissions.key,
            name: permissions.name,
            description: permissions.description,
        })
        .from(permissions)

    if (currentUserAccess.isSuperUser) {
        return permissionRows
    }

    return permissionRows.filter(function (permission) {
        return permission.key !== SUPER_USER_PERMISSION
    })
}

export async function getUsersService() {
    const currentUserAccess = await getCurrentUserAccess()
    const result = await db
        .select({
            id: users.id,
            username: users.username,
            email: users.email,
            firstName: user_profiles.firstName,
            lastName: user_profiles.lastName,
            street: user_profiles.street,
            houseNumber: user_profiles.houseNumber,
            postalCode: user_profiles.postalCode,
            city: user_profiles.city,
            profileImageUpdatedAt: user_profiles.profileImageUpdatedAt,
            isActive: users.isActive,
            createdByUserId: users.createdByUserId,
            createdAt: users.createdAt,
        })
        .from(users)
        .leftJoin(user_profiles, eq(user_profiles.userId, users.id))
        .where(eq(users.isDeleted, false))
        .orderBy(desc(users.createdAt), asc(users.id))

    const permissionRows = result.length
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
              .where(eq(users.isDeleted, false))
              .orderBy(asc(userPermissions.userId), asc(permissions.key))
        : []
    const permissionKeysByUserId = new Map<string, Array<string>>()

    for (const permission of permissionRows) {
        const keys = permissionKeysByUserId.get(permission.userId) ?? []
        keys.push(permission.key)
        permissionKeysByUserId.set(permission.userId, keys)
    }

    return result.map(function (user) {
        const userPermissionKeys = permissionKeysByUserId.get(user.id) ?? []
        const { createdAt, profileImageUpdatedAt, ...userData } = user
        const isSuperUser = hasSuperUserPermission(userPermissionKeys)

        return Object.assign(userData, {
            isDefaultUser: user.createdByUserId === null,
            isSuperUser,
            isCurrentUser: user.id === currentUserAccess.userId,
            permissions: currentUserAccess.isSuperUser
                ? userPermissionKeys
                : getVisiblePermissionKeys(
                      userPermissionKeys,
                      currentUserAccess.isSuperUser,
                  ),
            profileImageVersion: profileImageUpdatedAt?.getTime() ?? null,
            createdAt: createdAt.toISOString(),
        })
    })
}
