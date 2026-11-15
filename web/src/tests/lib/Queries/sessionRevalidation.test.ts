import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'bun:test'
import { sessionConfig } from '@/config/session.config.ts'
import { AUTHENTICATED_SESSION_QUERY_KEY } from '@/lib/Queries/authenticatedSessionCache.ts'
import { revalidateCurrentSession } from '@/lib/Queries/sessionRevalidation.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import {
    createActivityTestClock,
    createActivityTestSession,
    flushSessionActivityTasks,
} from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'

const disposers: Array<() => void> = []

function createHarness() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    })
    const clock = createActivityTestClock()
    const abort = new AbortController()
    const read = vi.fn(async function (
        _signal: AbortSignal,
    ): Promise<AuthenticatedSessionQueryData> {
        return createActivityTestSession()
    })
    const onInactive = vi.fn()
    queryClient.setQueryData(
        AUTHENTICATED_SESSION_QUERY_KEY,
        createActivityTestSession(),
    )
    disposers.push(function () {
        abort.abort()
        queryClient.clear()
    })
    return {
        queryClient,
        clock,
        abort,
        read,
        onInactive,
        getSession: () =>
            queryClient.getQueryData<AuthenticatedSessionQueryData>(
                AUTHENTICATED_SESSION_QUERY_KEY,
            ),
        validate: () =>
            revalidateCurrentSession({
                queryClient,
                signal: abort.signal,
                readSession: read,
                onInactive,
                requestTimeoutMs: sessionConfig.activityRequestTimeoutMs,
                schedule: clock.schedule,
            }),
    }
}

afterEach(function () {
    for (const dispose of disposers.splice(0)) dispose()
})

describe('Current session revalidation after revocation', function () {
    it('keeps a server-validated active session and unrelated cached data', async function () {
        const test = createHarness()
        test.queryClient.setQueryData(['private-query'], {
            private: 'current data',
        })
        const newer = createActivityTestSession({
            absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
        })
        test.read.mockResolvedValue(newer)
        expect(await test.validate()).toBe('active')
        expect(test.getSession()).toEqual(newer)
        expect(
            test.queryClient.getQueryData<Record<string, string>>([
                'private-query',
            ]),
        ).toEqual({ private: 'current data' })
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
    })

    it('writes confirmed null and removes other cached data before the login callback', async function () {
        const test = createHarness()
        test.queryClient.setQueryData(['private-query'], {
            private: 'old data',
        })
        test.read.mockResolvedValue({ user: null })
        const observations: Array<unknown> = []
        test.onInactive.mockImplementation(function () {
            observations.push(
                test.getSession(),
                test.queryClient.getQueryData(['private-query']),
            )
        })
        expect(await test.validate()).toBe('inactive')
        expect(test.getSession()).toEqual({ user: null })
        expect(observations).toEqual([{ user: null }, undefined])
        expect(test.onInactive).toHaveBeenCalledTimes(1)
        expect(test.clock.pending.size).toBe(0)
    })

    it('cancels an earlier canonical QueryClient fetch even when its query function ignores abort', async function () {
        const test = createHarness()
        const prior = Promise.withResolvers<AuthenticatedSessionQueryData>()
        const oldFetch = test.queryClient
            .fetchQuery({
                queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
                staleTime: 0,
                queryFn: () => prior.promise,
            })
            .catch(() => undefined)
        await flushSessionActivityTasks()
        test.read.mockResolvedValue({ user: null })
        expect(await test.validate()).toBe('inactive')
        prior.resolve(createActivityTestSession())
        await oldFetch
        await flushSessionActivityTasks()
        expect(test.getSession()).toEqual({ user: null })
        expect(test.onInactive).toHaveBeenCalledTimes(1)
    })

    it.each([{ user: null }, createActivityTestSession()])(
        'discards a late response after a new login cache write %#',
        async function (oldResult) {
            const test = createHarness()
            const pending =
                Promise.withResolvers<AuthenticatedSessionQueryData>()
            test.read.mockImplementation(() => pending.promise)
            const result = test.validate()
            await flushSessionActivityTasks()
            const newer = createActivityTestSession({
                absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
            })
            test.queryClient.setQueryData(
                AUTHENTICATED_SESSION_QUERY_KEY,
                newer,
            )
            pending.resolve(oldResult)
            expect(await result).toBe('stale')
            expect(test.getSession()).toEqual(newer)
            expect(test.onInactive).not.toHaveBeenCalled()
            expect(test.read.mock.calls[0]?.[0].aborted).toBe(true)
            expect(test.clock.pending.size).toBe(0)
        },
    )

    it('recognizes a newer query success even when structural sharing preserves the same object', async function () {
        const test = createHarness()
        const original = test.getSession()
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        test.read.mockImplementation(() => pending.promise)
        const result = test.validate()
        await flushSessionActivityTasks()
        await test.queryClient.fetchQuery({
            queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
            staleTime: 0,
            queryFn: async () => original,
        })
        pending.resolve({ user: null })
        expect(await result).toBe('stale')
        expect(test.getSession()).toBe(original)
        expect(test.onInactive).not.toHaveBeenCalled()
    })

    it('does not resurrect a removed cache entry or end its replacement session', async function () {
        const test = createHarness()
        const original = test.getSession()
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        test.read.mockImplementation(() => pending.promise)
        const result = test.validate()
        await flushSessionActivityTasks()
        test.queryClient.removeQueries({
            queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
            exact: true,
        })
        test.queryClient.setQueryData(AUTHENTICATED_SESSION_QUERY_KEY, original)
        pending.resolve({ user: null })
        expect(await result).toBe('stale')
        expect(test.getSession()).toEqual(original)
        expect(test.onInactive).not.toHaveBeenCalled()
    })

    it('does not invalidate a current denial due to unrelated query updates', async function () {
        const test = createHarness()
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        test.read.mockImplementation(() => pending.promise)
        const result = test.validate()
        await flushSessionActivityTasks()
        test.queryClient.setQueryData(
            [...AUTHENTICATED_SESSION_QUERY_KEY, 'other-scope'],
            { user: null },
        )
        test.queryClient.setQueryData(['another-query'], 42)
        pending.resolve({ user: null })
        expect(await result).toBe('inactive')
        expect(test.onInactive).toHaveBeenCalledTimes(1)
    })

    it('bounds an abort-ignoring request and preserves all cache data after timeout', async function () {
        const test = createHarness()
        const original = test.getSession()
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        test.read.mockImplementation(() => pending.promise)
        const result = test.validate()
        await flushSessionActivityTasks()
        await test.clock.advance(sessionConfig.activityRequestTimeoutMs)
        expect(await result).toBe('unavailable')
        expect(test.read.mock.calls[0]?.[0].aborted).toBe(true)
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(test.getSession()).toBe(original)
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
    })

    it('invalidates an in-flight snapshot immediately when another event aborts its signal', async function () {
        const test = createHarness()
        const original = test.getSession()
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        test.read.mockImplementation(() => pending.promise)
        const result = test.validate()
        await flushSessionActivityTasks()
        test.abort.abort()
        expect(await result).toBe('stale')
        expect(test.read.mock.calls[0]?.[0].aborted).toBe(true)
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(test.getSession()).toBe(original)
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
    })

    it('performs no read for an already aborted request', async function () {
        const test = createHarness()
        test.abort.abort()
        expect(await test.validate()).toBe('stale')
        expect(test.read).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
    })

    it('treats server or network failure as uncertainty without a cache mutation', async function () {
        const test = createHarness()
        const original = test.getSession()
        test.read.mockRejectedValue(new Error('network unavailable'))
        expect(await test.validate()).toBe('unavailable')
        expect(test.getSession()).toBe(original)
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
    })
})
