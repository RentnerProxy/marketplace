import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'
import { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import {
    PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY,
    PERMISSION_MANAGEMENT_USERS_QUERY_KEY,
} from '@/lib/Permissions/permissionManagementCache.ts'

export default function usePermissionManagementRealtime() {
    const queryClient = useQueryClient()

    useEffect(() => {
        return subscribeToRealtimeEvents(async function (realtimeEvent) {
            if (realtimeEvent.type === 'admin-permissions.updated') {
                return queryClient.invalidateQueries({
                    queryKey: PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY,
                    refetchType: 'none',
                })
            }

            if (
                realtimeEvent.type === 'admin-user.updated' ||
                realtimeEvent.type === 'admin-user.access-revoked'
            ) {
                await Promise.all([
                    queryClient.invalidateQueries({
                        queryKey: PERMISSION_MANAGEMENT_USERS_QUERY_KEY,
                    }),
                    queryClient.invalidateQueries({
                        queryKey: ADMIN_USERS_QUERY_KEY,
                    }),
                ])
            }
        })
    }, [queryClient])
}
