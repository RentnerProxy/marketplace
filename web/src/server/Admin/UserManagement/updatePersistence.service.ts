import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type { NormalizedUserUpdate } from './Types/user-update.types.ts'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { accountIdentityMatchesService } from '@/server/Auth/accountUniqueness.service.ts'
import {
    passwordResetTokens,
    permissions,
    sessions,
    trustedDevices,
    userPermissions,
    user_profiles,
    users,
} from '@/db/schema.ts'

export async function lockUserForUpdateInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
) {
    const userRows = await transaction
        .select({
            username: users.username,
            email: users.email,
            isActive: users.isActive,
            isDeleted: users.isDeleted,
            createdByUserId: users.createdByUserId,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for('update')

    return userRows.at(0) ?? null
}

export async function loadUserProfileInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
) {
    const profileRows = await transaction
        .select({
            firstName: user_profiles.firstName,
            lastName: user_profiles.lastName,
            street: user_profiles.street,
            houseNumber: user_profiles.houseNumber,
            postalCode: user_profiles.postalCode,
            city: user_profiles.city,
        })
        .from(user_profiles)
        .where(eq(user_profiles.userId, userId))
        .limit(1)

    return (
        profileRows.at(0) ?? {
            firstName: null,
            lastName: null,
            street: null,
            houseNumber: null,
            postalCode: null,
            city: null,
        }
    )
}

export async function loadSelectedPermissionsInTransaction(
    transaction: DatabaseTransaction,
    permissionKeys: Array<string>,
) {
    if (permissionKeys.length === 0) {
        return []
    }

    return transaction
        .select({
            id: permissions.id,
            key: permissions.key,
        })
        .from(permissions)
        .where(inArray(permissions.key, permissionKeys))
        .for('share')
}

export async function hasDuplicateVisibleUserInTransaction(
    transaction: DatabaseTransaction,
    input: Pick<NormalizedUserUpdate, 'id' | 'username' | 'email'>,
) {
    const duplicateUsers = await transaction
        .select({ id: users.id })
        .from(users)
        .where(
            and(
                ne(users.id, input.id),
                eq(users.isDeleted, false),
                accountIdentityMatchesService(input),
            ),
        )
        .limit(1)

    return duplicateUsers.length > 0
}

export async function writeUserAndProfileInTransaction(
    transaction: DatabaseTransaction,
    input: NormalizedUserUpdate,
) {
    const updatedUsers = await transaction
        .update(users)
        .set({ username: input.username, email: input.email })
        .where(eq(users.id, input.id))
        .returning({
            id: users.id,
            username: users.username,
            email: users.email,
            isActive: users.isActive,
            createdByUserId: users.createdByUserId,
            createdAt: users.createdAt,
        })
    const user = updatedUsers.at(0)

    if (!user) {
        return null
    }

    const updatedProfiles = await transaction
        .insert(user_profiles)
        .values({
            userId: input.id,
            ...input.profile,
        })
        .onConflictDoUpdate({
            target: user_profiles.userId,
            set: input.profile,
        })
        .returning({
            firstName: user_profiles.firstName,
            lastName: user_profiles.lastName,
            street: user_profiles.street,
            houseNumber: user_profiles.houseNumber,
            postalCode: user_profiles.postalCode,
            city: user_profiles.city,
            profileImageUpdatedAt: user_profiles.profileImageUpdatedAt,
        })
    const userProfile = updatedProfiles.at(0) ?? {
        ...input.profile,
        profileImageUpdatedAt: null,
    }

    return { user, userProfile }
}

export async function revokeUserAuthenticationStateInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
) {
    await transaction
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, userId))
    await transaction.delete(sessions).where(eq(sessions.userId, userId))
    await transaction
        .delete(trustedDevices)
        .where(eq(trustedDevices.userId, userId))
}

export async function replaceUserPermissionsInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    selectedPermissions: Array<{ id: string }>,
) {
    await transaction
        .delete(userPermissions)
        .where(eq(userPermissions.userId, userId))

    if (selectedPermissions.length === 0) {
        return
    }

    await transaction.insert(userPermissions).values(
        selectedPermissions.map(function (permission) {
            return {
                userId,
                permissionId: permission.id,
            }
        }),
    )
}
