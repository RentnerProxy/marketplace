import { useQuery } from '@tanstack/react-query'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { getAccountManagementPermission } from '@/lib/UserManagement/accountManagementPermission.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'

import { getUsersHandler } from '../../../middleware.ts'
import type { UserManagementUser } from '../../../Types/user-management-domain.types.ts'
import type { UsersTableQueryReturn } from '../Types/user-management-table.types.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'

const EMPTY_USERS: Array<UserManagementUser> = []
export default function useUsersTableQuery(
    accountType: AccountType,
): UsersTableQueryReturn {
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())
    const actorUserId = sessionData?.user?.id
    const canManageAccounts =
        Boolean(actorUserId) &&
        hasPermission(
            sessionData?.permissions,
            getAccountManagementPermission(accountType),
        )
    const usersQuery = useQuery({
        queryKey: [
            ...ADMIN_USERS_QUERY_KEY,
            accountType,
            actorUserId ?? 'anonymous',
        ],
        enabled: canManageAccounts,
        queryFn: () => getUsersHandler({ data: { accountType } }),
    })
    const users = canManageAccounts
        ? (usersQuery.data ?? EMPTY_USERS)
        : EMPTY_USERS
    return {
        state: {
            users,
            isLoadingUsers: usersQuery.isLoading || usersQuery.isFetching,
        },
    }
}
