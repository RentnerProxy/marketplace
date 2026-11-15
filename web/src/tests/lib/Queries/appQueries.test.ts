import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { createActivityTestSession } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'
import { setAuthenticatedSessionQueryData } from '@/lib/Queries/authenticatedSessionCache.ts'

const readSession = vi.fn(async function (_options: { signal: AbortSignal }) {
    return createActivityTestSession()
})
vi.mock('@/features/Auth/middleware.ts', () => ({
    validateSessionHandler: readSession,
}))
vi.mock('@/features/Admin/SystemSettings/middleware.ts', () => ({
    getSystemSettingsHandler: vi.fn(),
}))

const { authenticatedSessionQueryOptions } =
    await import('@/lib/Queries/appQueries.ts')

let queryClient: QueryClient
beforeEach(function () {
    queryClient = new QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    })
    vi.clearAllMocks()
})
afterEach(function () {
    queryClient.clear()
})

describe('Fetched authenticated identity boundary', function () {
    it('clears private cache for a fetched account change', async function () {
        const original = createActivityTestSession()
        setAuthenticatedSessionQueryData(queryClient, original)
        queryClient.setQueryData(['notifications'], ['private-marker-A'])
        const next = createActivityTestSession()
        if (!next.user) throw new Error('Missing fixture user')
        next.user.id = 'dummy-user-B'
        readSession.mockResolvedValueOnce(next)

        const result = await queryClient.fetchQuery({
            ...authenticatedSessionQueryOptions(),
            staleTime: 0,
        })
        expect(result.user?.id).toBe('dummy-user-B')
        expect(queryClient.getQueryData(['notifications'])).toBeUndefined()
        expect(readSession.mock.calls[0]?.[0].signal).toBeInstanceOf(
            AbortSignal,
        )
    })

    it('ignores a cancelled session response', async function () {
        const original = createActivityTestSession()
        setAuthenticatedSessionQueryData(queryClient, original)
        const response = Promise.withResolvers<typeof original>()
        readSession.mockImplementationOnce(() => response.promise)
        const pending = queryClient
            .fetchQuery({ ...authenticatedSessionQueryOptions(), staleTime: 0 })
            .catch(() => undefined)
        const next = createActivityTestSession()
        if (!next.user) throw new Error('Missing fixture user')
        next.user.id = 'dummy-user-B'
        setAuthenticatedSessionQueryData(queryClient, next)
        queryClient.setQueryData(['notifications'], ['private-marker-B'])
        response.resolve(original)
        await pending
        expect(
            queryClient.getQueryData<Array<string>>(['notifications']),
        ).toEqual(['private-marker-B'])
    })
})
