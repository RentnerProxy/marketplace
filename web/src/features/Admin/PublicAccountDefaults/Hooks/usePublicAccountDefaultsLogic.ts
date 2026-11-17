import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getPublicAccountDefaultsHandler } from '@/features/Admin/PermissionManagement/middleware.ts'
import useDefaultPermissions from '@/features/Admin/PermissionManagement/Hooks/useDefaultPermissions.ts'
import { PUBLIC_ACCOUNT_DEFAULTS_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import type { PublicAccountDefaultsLogic } from '../Types/public-account-defaults-logic.types.ts'

const emptyDefaults = { permissions: [], defaultPermissionKeys: [] }

export default function usePublicAccountDefaultsLogic(): PublicAccountDefaultsLogic {
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: PUBLIC_ACCOUNT_DEFAULTS_QUERY_KEY,
        queryFn: getPublicAccountDefaultsHandler,
    })
    const { permissions, defaultPermissionKeys } = query.data ?? emptyDefaults
    const { state, handler } = useDefaultPermissions({ defaultPermissionKeys })

    useEffect(
        () =>
            subscribeToRealtimeEvents(async (event) => {
                if (
                    event.type === 'admin-permissions.updated' &&
                    event.payload.scope === 'defaults'
                )
                    await queryClient.invalidateQueries({
                        queryKey: PUBLIC_ACCOUNT_DEFAULTS_QUERY_KEY,
                    })
            }),
        [queryClient],
    )

    return {
        state: {
            ...state,
            permissions,
            isLoading: query.isPending,
            isError: query.isError,
        },
        handler: {
            ...handler,
            handleRetry: () => {
                void query.refetch().catch(toastAppError)
            },
        },
    }
}
