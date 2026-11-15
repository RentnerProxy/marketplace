import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import {
    RESTORE_STATUS_QUERY_KEY,
    restoreStatusQueryOptions,
} from '@/lib/Restore/restoreStatus.ts'
import type { RestoreStatusResult } from '../Types/restore-status.types.ts'
import type { RestoreStatus } from '@/lib/Restore/Types/restore.types.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

export default function useRestoreStatus(): RestoreStatusResult {
    const queryClient = useQueryClient()
    const statusQuery = useQuery(restoreStatusQueryOptions())
    const refetchStatus = statusQuery.refetch
    const refreshStatus = useCallback(
        function () {
            void refetchStatus().catch(toastAppError)
        },
        [refetchStatus],
    )

    useEffect(() => {
        return subscribeToRealtimeEvents(function (event) {
            if (event.type === 'connection.ready') {
                refreshStatus()
                return
            }

            if (event.type !== 'system-restore.changed') {
                return
            }

            queryClient.setQueryData<RestoreStatus>(
                RESTORE_STATUS_QUERY_KEY,
                event.payload,
            )
        })
    }, [queryClient, refreshStatus])

    useEffect(() => {
        function handleVisibilityChange() {
            if (document.visibilityState === 'visible') {
                refreshStatus()
            }
        }

        window.addEventListener('focus', refreshStatus)
        window.addEventListener('pageshow', refreshStatus)
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return function () {
            window.removeEventListener('focus', refreshStatus)
            window.removeEventListener('pageshow', refreshStatus)
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            )
        }
    }, [refreshStatus])

    return {
        state: {
            restoreStatus: statusQuery.data ?? null,
            isLoading: statusQuery.isLoading,
            isError: statusQuery.isError,
        },
    }
}
