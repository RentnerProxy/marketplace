import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import {
    AUTHENTICATED_SESSION_QUERY_KEY,
    clearAuthenticatedQueryCache,
    setAuthenticatedSessionQueryData,
} from '@/lib/Queries/authenticatedSessionCache.ts'
import {
    createActivityTestSession,
    flushSessionActivityTasks,
} from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'

let queryClient: QueryClient

beforeEach(function () {
    queryClient = new QueryClient({
        defaultOptions: {
            queries: { staleTime: 30_000, gcTime: Infinity, retry: false },
        },
    })
})

afterEach(function () {
    queryClient.clear()
})

describe('Authenticated query cache boundaries', function () {
    it.each([['notifications'], ['current-user-passkeys']])(
        'does not give the next account fresh cached data from %s',
        async function (key) {
            setAuthenticatedSessionQueryData(
                queryClient,
                createActivityTestSession(),
            )
            queryClient.setQueryData([key], ['private-marker-A'])
            clearAuthenticatedQueryCache(queryClient)
            const next = createActivityTestSession()
            if (!next.user) throw new Error('Missing fixture user')
            next.user.id = 'dummy-user-B'
            setAuthenticatedSessionQueryData(queryClient, next)

            const response = Promise.withResolvers<Array<string>>()
            const observer = new QueryObserver(queryClient, {
                queryKey: [key],
                queryFn: () => response.promise,
            })
            const unsubscribe = observer.subscribe(function () {})
            try {
                expect(observer.getCurrentResult().data).toBeUndefined()
                expect(observer.getCurrentResult().isPending).toBe(true)
                response.resolve(['private-marker-B'])
                await flushSessionActivityTasks()
                expect(observer.getCurrentResult().data).toEqual([
                    'private-marker-B',
                ])
            } finally {
                unsubscribe()
            }
        },
    )

    it('clears private data before publishing another identity', function () {
        setAuthenticatedSessionQueryData(
            queryClient,
            createActivityTestSession(),
        )
        queryClient.setQueryData(['notifications'], ['private-marker-A'])
        queryClient.setQueryData(['current-user-passkeys'], ['passkey-A'])
        const next = createActivityTestSession()
        if (!next.user) throw new Error('Missing fixture user')
        next.user.id = 'dummy-user-B'
        let checked = false
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            if (
                event.type === 'updated' &&
                event.query.queryKey[0] ===
                    AUTHENTICATED_SESSION_QUERY_KEY[0] &&
                queryClient.getQueryData<typeof next>(
                    AUTHENTICATED_SESSION_QUERY_KEY,
                )?.user?.id === 'dummy-user-B'
            ) {
                checked = true
                expect(
                    queryClient.getQueryData(['notifications']),
                ).toBeUndefined()
                expect(
                    queryClient.getQueryData(['current-user-passkeys']),
                ).toBeUndefined()
            }
        })
        try {
            setAuthenticatedSessionQueryData(queryClient, next)
            expect(checked).toBe(true)
        } finally {
            unsubscribe()
        }
    })

    it('preserves same-user cache on session refresh', function () {
        const session = createActivityTestSession()
        setAuthenticatedSessionQueryData(queryClient, session)
        queryClient.setQueryData(['notifications'], ['private-marker-A'])
        setAuthenticatedSessionQueryData(queryClient, {
            ...session,
            expiresAt: '2026-10-15T23:00:00.000Z',
        })
        expect(
            queryClient.getQueryData<Array<string>>(['notifications']),
        ).toEqual(['private-marker-A'])
    })

    it('clears private data when the session becomes inactive', function () {
        setAuthenticatedSessionQueryData(
            queryClient,
            createActivityTestSession(),
        )
        queryClient.setQueryData(['notifications'], ['private-marker-A'])
        setAuthenticatedSessionQueryData(queryClient, { user: null })
        expect(queryClient.getQueryData(['notifications'])).toBeUndefined()
        expect(
            queryClient.getQueryData<AuthenticatedSessionQueryData>(
                AUTHENTICATED_SESSION_QUERY_KEY,
            ),
        ).toEqual({ user: null })
    })

    it('ignores an old private response after cleanup', async function () {
        const response = Promise.withResolvers<Array<string>>()
        const oldFetch = queryClient
            .fetchQuery({
                queryKey: ['notifications'],
                queryFn: () => response.promise,
            })
            .catch(() => undefined)
        clearAuthenticatedQueryCache(queryClient)
        queryClient.setQueryData(['notifications'], ['private-marker-B'])
        response.resolve(['private-marker-A'])
        await oldFetch
        await flushSessionActivityTasks()
        expect(
            queryClient.getQueryData<Array<string>>(['notifications']),
        ).toEqual(['private-marker-B'])
    })

    it('cancels stale session fetches on account change', async function () {
        const original = createActivityTestSession()
        setAuthenticatedSessionQueryData(queryClient, original)
        const response = Promise.withResolvers<typeof original>()
        const oldFetch = queryClient
            .fetchQuery({
                queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
                staleTime: 0,
                queryFn: () => response.promise,
            })
            .catch(() => undefined)
        const next = createActivityTestSession()
        if (!next.user) throw new Error('Missing fixture user')
        next.user.id = 'dummy-user-B'
        setAuthenticatedSessionQueryData(queryClient, next)
        response.resolve(original)
        await oldFetch
        await flushSessionActivityTasks()
        expect(
            queryClient.getQueryData<AuthenticatedSessionQueryData>(
                AUTHENTICATED_SESSION_QUERY_KEY,
            ),
        ).toEqual(next)
    })
})
