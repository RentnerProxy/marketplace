import * as Query from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

const queryExports = { ...Query }
const client = new Query.QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
})
const pending: Promise<unknown>[] = []
const fetchMock = vi.fn<typeof fetch>()
const onError = vi.fn()
const intentHook = vi.fn((_userId: string | null) => ({
    state: { pendingManualBackupId: null },
    handler: { handleSetPendingManualBackup: () => false },
}))
vi.mock('@tanstack/react-query', () => ({
    ...queryExports,
    useQueryClient: () => client,
    useQuery: () => ({ data: undefined }),
    useMutation<T>(options: UseMutationOptions<T>) {
        const observer = new queryExports.MutationObserver(client, options)
        return {
            isPending: false,
            mutate: () => {
                pending.push(observer.mutate().catch(() => undefined))
            },
        }
    },
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['session'] }),
}))
vi.mock('@/lib/Backups/backupCache.ts', () => ({
    ADMIN_BACKUPS_QUERY_KEY: ['admin-backups'],
}))
vi.mock(
    '@/features/Admin/Backups/Hooks/usePendingManualBackupIntent.ts',
    () => ({ default: intentHook }),
)
const { default: useCreation } =
    await import('@/features/Admin/Backups/Hooks/useManualBackupCreation.ts')
beforeEach(() => {
    vi.clearAllMocks()
    pending.length = 0
    stubTestGlobal('fetch', fetchMock)
})
afterEach(() => {
    client.clear()
    restoreTestGlobals()
})

it.each([503, 202])(
    'reports a safe fallback for a non-JSON response with status %s',
    async (status) => {
        fetchMock.mockResolvedValueOnce(
            new Response('synthetic invalid JSON', { status }),
        )
        useCreation({ onError }).handler.handleCreateBackup()
        await Promise.all(pending)
        expect(intentHook).toHaveBeenCalledWith(null)
        expect(onError.mock.calls[0]?.[0]).toMatchObject({
            message: 'common.error',
        })
        expect(useCreation({ onError }).state.isCreating).toBe(false)
    },
)
