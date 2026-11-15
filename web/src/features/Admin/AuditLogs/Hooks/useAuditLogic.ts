import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getAuditLogsHandler } from '../middleware.ts'
import { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import type { AuditLogsLogicReturn } from '../Types/audit-log-component.types.ts'

const ADMIN_AUDIT_LOGS_QUERY_KEY = ['admin-audit-logs']

export default function useAuditLogic(): AuditLogsLogicReturn {
    const queryClient = useQueryClient()
    const auditLogsQuery = useQuery({
        queryKey: ADMIN_AUDIT_LOGS_QUERY_KEY,
        queryFn: getAuditLogsHandler,
    })

    useEffect(() => {
        return subscribeToRealtimeEvents(async function (realtimeEvent) {
            if (realtimeEvent.type !== 'audit-log.created') {
                return
            }

            await queryClient.refetchQueries({
                queryKey: ADMIN_AUDIT_LOGS_QUERY_KEY,
                exact: true,
            })
        })
    }, [queryClient])

    return {
        state: {
            auditLogs: auditLogsQuery.data ?? [],
            isLoadingAuditLogs: auditLogsQuery.isLoading,
        },
    }
}
