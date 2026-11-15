import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { RESTORE_STATUS_QUERY_KEY } from './restoreStatus.ts'

function isRestoreStatusQueryKey(queryKey: QueryKey) {
    return (
        queryKey.length === RESTORE_STATUS_QUERY_KEY.length &&
        queryKey.every(function (value, index) {
            return value === RESTORE_STATUS_QUERY_KEY[index]
        })
    )
}

export function clearPreRestoreQueryCache(queryClient: QueryClient) {
    queryClient.removeQueries({
        predicate: function (query) {
            return !isRestoreStatusQueryKey(query.queryKey)
        },
    })
}
