import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
    permissions,
    accountPermissions,
    user_profiles,
    users,
} from '@/db/schema.ts'
import { hasSuperUserPermission } from '@/lib/Permissions/permissions.ts'
import { PUBLIC_PERMISSION_KEYS } from '@/config/permissions.config.ts'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'

export async function getPermissionsService(accountType: AccountType) {
    return db
        .select({
            id: permissions.id,
            key: permissions.key,
            name: permissions.name,
            description: permissions.description,
        })
        .from(permissions)
        .where(
            accountType === 'public'
                ? inArray(permissions.key, PUBLIC_PERMISSION_KEYS)
                : undefined,
        )
        .orderBy(asc(permissions.key))
}

export async function getUsersService(
    accountType: AccountType,
    actorUserId: string,
) {
    const result = await db
        .select({
            id: users.id,
            username: users.username,
            email: users.email,
            profileImageUpdatedAt: user_profiles.profileImageUpdatedAt,
            isActive: users.isActive,
            createdAt: users.createdAt,
        })
        .from(users)
        .leftJoin(user_profiles, eq(user_profiles.userId, users.id))
        .where(
            and(eq(users.isDeleted, false), eq(users.accountType, accountType)),
        )
        .orderBy(desc(users.createdAt), asc(users.id))

    const permissionRows = result.length
        ? await db
              .select({
                  userId: accountPermissions.userId,
                  key: permissions.key,
              })
              .from(accountPermissions)
              .innerJoin(
                  permissions,
                  eq(permissions.id, accountPermissions.permissionId),
              )
              .innerJoin(users, eq(users.id, accountPermissions.userId))
              .where(
                  and(
                      eq(users.isDeleted, false),
                      eq(users.accountType, accountType),
                  ),
              )
              .orderBy(asc(accountPermissions.userId), asc(permissions.key))
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
            isSuperUser,
            isCurrentUser: user.id === actorUserId,
            permissions: userPermissionKeys,
            profileImageVersion: profileImageUpdatedAt?.getTime() ?? null,
            createdAt: createdAt.toISOString(),
        })
    })
}
