import { queryOptions } from '@tanstack/react-query'
import {
    getBackupOverviewHandler,
    getBackupCreationProgressHandler,
} from '@/features/Admin/Backups/middleware.ts'

export const ADMIN_BACKUPS_QUERY_KEY = ['admin-backups'] as const

export function backupOverviewQueryOptions() {
    return queryOptions({
        queryKey: ADMIN_BACKUPS_QUERY_KEY,
        queryFn: getBackupOverviewHandler,
        refetchInterval: function (query) {
            const hasActiveRun = query.state.data?.runs.some((run) =>
                ['queued', 'running'].includes(run.status),
            )

            return hasActiveRun ? 3_000 : false
        },
        refetchIntervalInBackground: false,
    })
}

export function backupCreationProgressQueryOptions(runId: string | null) {
    return queryOptions({
        queryKey: ['admin-backup-creation-progress', runId ?? 'active'],
        queryFn: function () {
            return getBackupCreationProgressHandler({
                data: { runId: runId ?? undefined },
            })
        },
        refetchInterval: function (query) {
            const progress = query.state.data
            return progress?.status === 'queued' ||
                progress?.status === 'running' ||
                (!progress && runId)
                ? 750
                : false
        },
        refetchIntervalInBackground: false,
        staleTime: 0,
    })
}
