import * as actualQuery from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

const actualQueryExports = { ...actualQuery }
const ActualMutationObserver = actualQuery.MutationObserver
const queryClient = new actualQuery.QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
})
const pending: Array<Promise<unknown>> = []
const runId = '019f5b07-80e2-7000-8000-000000000001'
let pendingRunId: string | null = null
const setPending = vi.fn(function (nextRunId: string) {
    pendingRunId = nextRunId
    return true
})
const fetchResponse = vi.fn<typeof fetch>()
const onError = vi.fn()
const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

vi.mock('@tanstack/react-query', () => ({
    ...actualQueryExports,
    useQueryClient: () => queryClient,
    useQuery: () => ({ data: { user: { id: 'synthetic-user' } } }),
    useMutation<T>(options: UseMutationOptions<T>) {
        const observer = new ActualMutationObserver(queryClient, options)
        return {
            isPending: false,
            mutate() {
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
    () => ({
        default: () => ({
            state: { pendingManualBackupId: pendingRunId },
            handler: { handleSetPendingManualBackup: setPending },
        }),
    }),
)

import useManualBackupCreation from '@/features/Admin/Backups/Hooks/useManualBackupCreation.ts'

beforeEach(function () {
    vi.clearAllMocks()
    pending.length = 0
    pendingRunId = null
    queryClient.clear()
    setPending.mockImplementation(function (nextRunId) {
        pendingRunId = nextRunId
        return true
    })
    stubTestGlobal('fetch', fetchResponse)
})

afterEach(function () {
    queryClient.clear()
    restoreTestGlobals()
})

describe('asynchrone manuelle Backup-Annahme', function () {
    it('fordert ohne Prefer-Header eine Erstellung an und merkt ausschließlich die angenommene Run-ID', async function () {
        fetchResponse.mockResolvedValueOnce(
            Response.json({ success: true, backupId: runId }, { status: 202 }),
        )
        const creation = useManualBackupCreation({ onError })
        expect(creation.state.isCreating).toBe(false)
        creation.handler.handleCreateBackup()
        await Promise.all(pending)

        expect(fetchResponse).toHaveBeenCalledWith(
            '/api/admin/backups/download',
            { method: 'POST' },
        )
        expect(setPending).toHaveBeenCalledWith(runId)
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-backups'] })
        expect(useManualBackupCreation({ onError }).state.isCreating).toBe(true)
        expect(onError).not.toHaveBeenCalled()
    })

    it('weist den entfernten synchronen 200-Binärvertrag ohne Lesen oder Download zurück', async function () {
        const response = new Response('synthetic-archive', {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
        })
        fetchResponse.mockResolvedValueOnce(response)
        useManualBackupCreation({ onError }).handler.handleCreateBackup()
        await Promise.all(pending)

        expect(onError).toHaveBeenCalledTimes(1)
        const error: unknown = onError.mock.calls[0]?.[0]
        expect(error).toBeInstanceOf(Error)
        expect(error instanceof Error && error.message).toBe('common.error')
        expect(response.bodyUsed).toBe(false)
        expect(setPending).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
    })

    it.each([
        { success: false, backupId: runId },
        { success: true, backupId: 'not-a-uuid' },
        null,
    ])(
        'merkt bei ungültigem 202-Inhalt keinen ausstehenden Run (Fall %#)',
        async function (body) {
            fetchResponse.mockResolvedValueOnce(
                Response.json(body, { status: 202 }),
            )
            useManualBackupCreation({ onError }).handler.handleCreateBackup()
            await Promise.all(pending)
            expect(onError).toHaveBeenCalledTimes(1)
            expect(setPending).not.toHaveBeenCalled()
            expect(invalidate).not.toHaveBeenCalled()
        },
    )

    it('reicht die sichere API-Fehlermeldung durch und merkt keine Annahme', async function () {
        fetchResponse.mockResolvedValueOnce(
            Response.json(
                { success: false, error: 'Sichere Meldung.' },
                { status: 500 },
            ),
        )
        useManualBackupCreation({ onError }).handler.handleCreateBackup()
        await Promise.all(pending)
        const error: unknown = onError.mock.calls[0]?.[0]
        expect(error).toBeInstanceOf(Error)
        expect(error instanceof Error && error.message).toBe('Sichere Meldung.')
        expect(setPending).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
    })

    it('meldet eine nicht speicherbare Run-Bindung als Fehler', async function () {
        setPending.mockReturnValueOnce(false)
        fetchResponse.mockResolvedValueOnce(
            Response.json({ success: true, backupId: runId }, { status: 202 }),
        )
        useManualBackupCreation({ onError }).handler.handleCreateBackup()
        await Promise.all(pending)
        expect(setPending).toHaveBeenCalledWith(runId)
        expect(onError).toHaveBeenCalledTimes(1)
        expect(invalidate).not.toHaveBeenCalled()
    })
})
