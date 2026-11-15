import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'bun:test'
import { clearPreRestoreQueryCache } from '@/lib/Restore/restoreQueryCache.ts'
import { RESTORE_STATUS_QUERY_KEY } from '@/lib/Restore/restoreStatus.ts'

describe('Restore-Query-Cache', function () {
    it('entfernt Daten vom Stand vor dem Restore, ohne den laufenden Fortschritt zurückzusetzen', function () {
        const queryClient = new QueryClient()
        const restoreStatus = {
            version: 1,
            status: 'running',
            phase: 'restoring-database',
            percent: 70,
        }
        queryClient.setQueryData(RESTORE_STATUS_QUERY_KEY, restoreStatus)
        queryClient.setQueryData(['authenticated-session'], {
            user: { id: 'alter-stand' },
        })
        queryClient.setQueryData(['admin-backups'], ['alter-stand'])

        clearPreRestoreQueryCache(queryClient)

        expect(
            queryClient.getQueryData<typeof restoreStatus>(
                RESTORE_STATUS_QUERY_KEY,
            ),
        ).toEqual(restoreStatus)
        expect(queryClient.getQueryData(['authenticated-session'])).toBe(
            undefined,
        )
        expect(queryClient.getQueryData(['admin-backups'])).toBe(undefined)
    })
})
