import type { UserManagementUser } from '@/features/Admin/UserManagement/Types/user-management-domain.types.ts'

export const ADMIN_USERS_QUERY_KEY = ['admin-users'] as const

export function updateUserActiveStateInList(
    users: Array<UserManagementUser> | undefined,
    userId: string,
    isActive: boolean,
) {
    if (!users) {
        return users
    }

    let hasUpdatedUser = false
    const updatedUsers = users.map(function (user) {
        if (user.id !== userId || user.isActive === isActive) {
            return user
        }

        hasUpdatedUser = true
        return { ...user, isActive }
    })

    return hasUpdatedUser ? updatedUsers : users
}
