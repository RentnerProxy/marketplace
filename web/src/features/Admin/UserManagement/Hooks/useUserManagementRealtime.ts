import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'
import type { UserManagementUser } from '../Types/user-management-domain.types.ts'
import { updateUserActiveStateInList } from '@/lib/UserManagement/userCache.ts'

export default function useUserManagementRealtime() {
    const queryClient = useQueryClient()

    useEffect(() => {
        return subscribeToRealtimeEvents(async function (realtimeEvent) {
            if (realtimeEvent.type === 'admin-user.updated') {
                await queryClient.invalidateQueries({
                    queryKey: ADMIN_USERS_QUERY_KEY,
                })
                return
            }

            if (realtimeEvent.type === 'admin-user.access-revoked') {
                queryClient.setQueriesData<Array<UserManagementUser>>(
                    { queryKey: ADMIN_USERS_QUERY_KEY },
                    (users) =>
                        updateUserActiveStateInList(
                            users,
                            realtimeEvent.payload.userId,
                            false,
                        ),
                )
            }
        })
    }, [queryClient])
}
