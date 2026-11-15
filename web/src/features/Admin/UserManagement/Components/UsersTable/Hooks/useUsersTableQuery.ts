import { useQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'

import { getUsersHandler } from '../../../middleware.ts'
import type { UserManagementUser } from '../../../Types/user-management-domain.types.ts'
import type { UsersTableQueryReturn } from '../Types/user-management-table.types.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'

const EMPTY_USERS: Array<UserManagementUser> = []
export default function useUsersTableQuery(): UsersTableQueryReturn {
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())
    const actorUserId = sessionData?.user?.id
    const hasFullPermissionVisibility =
        sessionData?.permissions?.includes(PERMISSIONS.ADMIN_SUPER_USER) ??
        false
    const usersQuery = useQuery({
        queryKey: [
            ...ADMIN_USERS_QUERY_KEY,
            actorUserId ?? 'anonymous',
            hasFullPermissionVisibility ? 'full' : 'restricted',
        ],
        enabled: Boolean(actorUserId),
        queryFn: getUsersHandler,
    })
    const users = actorUserId ? (usersQuery.data ?? EMPTY_USERS) : EMPTY_USERS
    return {
        state: {
            users,
            isLoadingUsers: usersQuery.isLoading || usersQuery.isFetching,
        },
    }
}
