import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import type { NormalizedUserUpdate } from './Types/user-update.types.ts'
import { and, eq, inArray, ne } from 'drizzle-orm'
import {
    accountIdentityMatchesService,
    hasStaffIdentityReservationInTransactionService,
} from '@/server/Auth/accountUniqueness.service.ts'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'
import {
    passwordResetTokens,
    permissions,
    sessions,
    trustedDevices,
    staffUserPermissions,
    user_profiles,
    users,
} from '@/db/schema.ts'

export async function lockUserForUpdateInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    accountType: AccountType,
) {
    const userRows = await transaction
        .select({
            username: users.username,
            email: users.email,
            isActive: users.isActive,
            isDeleted: users.isDeleted,
        })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.accountType, accountType)))
        .limit(1)
        .for('update')

    return userRows.at(0) ?? null
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

    return (
        duplicateUsers.length > 0 ||
        (await hasStaffIdentityReservationInTransactionService(
            transaction,
            input,
        ))
    )
}

export async function writeUserInTransaction(
    transaction: DatabaseTransaction,
    input: NormalizedUserUpdate,
    emailChanged: boolean,
) {
    const updatedUsers = await transaction
        .update(users)
        .set({
            username: input.username,
            email: input.email,
            ...(emailChanged ? { emailVerifiedAt: null } : {}),
        })
        .where(eq(users.id, input.id))
        .returning({
            id: users.id,
            username: users.username,
            email: users.email,
            isActive: users.isActive,
            accountType: users.accountType,
            createdAt: users.createdAt,
        })
    const user = updatedUsers.at(0)

    if (!user) {
        return null
    }

    const profileRows = await transaction
        .select({ profileImageUpdatedAt: user_profiles.profileImageUpdatedAt })
        .from(user_profiles)
        .where(eq(user_profiles.userId, input.id))
        .limit(1)
    const userProfile = profileRows.at(0) ?? { profileImageUpdatedAt: null }

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
        .delete(staffUserPermissions)
        .where(eq(staffUserPermissions.userId, userId))

    if (selectedPermissions.length === 0) {
        return
    }

    await transaction.insert(staffUserPermissions).values(
        selectedPermissions.map(function (permission) {
            return {
                userId,
                permissionId: permission.id,
            }
        }),
    )
}
