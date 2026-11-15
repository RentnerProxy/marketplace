import * as actualReact from 'react'
import * as actualQuery from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { sessionConfig } from '@/config/session.config.ts'
import { AUTHENTICATED_SESSION_QUERY_KEY } from '@/lib/Queries/authenticatedSessionCache.ts'
import type { SessionActivityTouchResult } from '@/lib/Auth/Session/Types/session-activity.types.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import {
    ActivityTestTarget,
    createActivityTestClock,
    createActivityTestSession,
    flushSessionActivityTasks,
} from './session-activity.test.helpers.ts'
import type { ActivityTestServerCallOptions } from './session-activity.test.types.ts'

const actualReactExports = { ...actualReact }
const actualQueryExports = { ...actualQuery }
const hookMocks = {
    queryClient: new actualQuery.QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    }),
    effects: [] as Array<actualReact.EffectCallback>,
    navigate: vi.fn(async function () {}),
    logout: vi.fn(),
    read: vi.fn(async function (
        _options: ActivityTestServerCallOptions,
    ): Promise<AuthenticatedSessionQueryData> {
        return createActivityTestSession()
    }),
    touch: vi.fn(async function (
        _options: ActivityTestServerCallOptions,
    ): Promise<SessionActivityTouchResult> {
        return { active: false }
    }),
}

vi.mock('react', function () {
    return {
        ...actualReactExports,
        useEffect(effect: actualReact.EffectCallback) {
            hookMocks.effects.push(effect)
        },
    }
})

vi.mock('@tanstack/react-query', function () {
    return {
        ...actualQueryExports,
        useQueryClient: () => hookMocks.queryClient,
    }
})

vi.mock('@tanstack/react-router', function () {
    return { useNavigate: () => hookMocks.navigate }
})

vi.mock('@/features/Auth/middleware.ts', function () {
    return {
        logoutHandler: hookMocks.logout,
        touchSessionActivityHandler: hookMocks.touch,
        validateSessionHandler: hookMocks.read,
    }
})

import useSessionActivity from '@/layouts/AuthenticatedLayout/Hooks/useSessionActivity.ts'

let clock = createActivityTestClock()
let target = new ActivityTestTarget()
let cleanup: (() => void) | undefined

function getSession() {
    return hookMocks.queryClient.getQueryData<AuthenticatedSessionQueryData>(
        AUTHENTICATED_SESSION_QUERY_KEY,
    )
}

function setSession(session: AuthenticatedSessionQueryData) {
    return hookMocks.queryClient.setQueryData(
        AUTHENTICATED_SESSION_QUERY_KEY,
        session,
    )
}

function mountActivityHook() {
    useSessionActivity()
    const effect = hookMocks.effects.shift()
    if (!effect) throw new Error('Missing session activity effect')
    const dispose = effect()
    if (typeof dispose !== 'function')
        throw new Error('Missing session activity cleanup')
    cleanup = dispose
}

beforeEach(function () {
    vi.clearAllMocks()
    clock = createActivityTestClock()
    target = new ActivityTestTarget()
    cleanup = undefined
    hookMocks.effects = []
    hookMocks.queryClient = new actualQueryExports.QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    })
    hookMocks.read.mockImplementation(async function () {
        return createActivityTestSession({
            expiresAt: new Date(
                clock.wallNow() + sessionConfig.idleDurationMs,
            ).toISOString(),
        })
    })
    hookMocks.touch.mockImplementation(async function () {
        return {
            active: true,
            expiresAt: new Date(
                clock.wallNow() + sessionConfig.idleDurationMs,
            ).toISOString(),
        }
    })
    hookMocks.navigate.mockResolvedValue(undefined)
    vi.spyOn(Date, 'now').mockImplementation(clock.wallNow)
    vi.spyOn(performance, 'now').mockImplementation(clock.monotonicNow)
    const timers = new Map<number, () => void>()
    let nextTimer = 0
    stubTestGlobal('document', target)
    stubTestGlobal('window', {
        setTimeout(callback: () => void, delay: number) {
            const id = ++nextTimer
            timers.set(
                id,
                clock.schedule(function () {
                    timers.delete(id)
                    callback()
                }, delay),
            )
            return id
        },
        clearTimeout(id: number) {
            timers.get(id)?.()
            timers.delete(id)
        },
    })
    setSession(createActivityTestSession())
})

afterEach(function () {
    cleanup?.()
    hookMocks.queryClient.clear()
    vi.restoreAllMocks()
    restoreTestGlobals()
})

describe('Session activity Hook and canonical QueryClient', function () {
    it('has no browser access, listeners or work until its client effect mounts', function () {
        stubTestGlobal('document', undefined)
        stubTestGlobal('window', undefined)
        useSessionActivity()
        expect(hookMocks.effects).toHaveLength(1)
        expect(target.activeListenerCount).toBe(0)
        expect(clock.pending.size).toBe(0)
        expect(hookMocks.touch).not.toHaveBeenCalled()
        expect(hookMocks.read).not.toHaveBeenCalled()
    })

    it('updates the canonical cached expiry after one trusted input without logging out', async function () {
        mountActivityHook()
        const original = getSession()
        await clock.advance(sessionConfig.activityThrottleMs)
        target.emit('pointerdown')
        await flushSessionActivityTasks()
        expect(hookMocks.touch).toHaveBeenCalledTimes(1)
        expect(hookMocks.touch).toHaveBeenCalledWith({
            signal: expect.any(AbortSignal),
        })
        expect(getSession()?.expiresAt).toBe(
            new Date(
                clock.wallNow() + sessionConfig.idleDurationMs,
            ).toISOString(),
        )
        expect(getSession()?.user).toBe(original?.user)
        expect(getSession()?.permissions).toBe(original?.permissions)
        expect(getSession()?.absoluteExpiresAt).toBe(
            original?.absoluteExpiresAt,
        )
        expect(hookMocks.read).not.toHaveBeenCalled()
        expect(hookMocks.logout).not.toHaveBeenCalled()
        expect(hookMocks.navigate).not.toHaveBeenCalled()
    })

    it('ignores hidden and synthetic inputs and never extends on focus or visibility changes', async function () {
        mountActivityHook()
        target.visibilityState = 'hidden'
        target.emit('keydown')
        target.visibilityState = 'visible'
        target.emit('keydown', false)
        target.emit('focus')
        target.emit('visibilitychange')
        await flushSessionActivityTasks()
        expect(hookMocks.touch).not.toHaveBeenCalled()
        expect(hookMocks.read).not.toHaveBeenCalled()
        await clock.advance(sessionConfig.idleDurationMs)
        expect(hookMocks.read).toHaveBeenCalledTimes(1)
        expect(hookMocks.touch).not.toHaveBeenCalled()
        expect(hookMocks.logout).not.toHaveBeenCalled()
    })

    it('writes only a current GET denial to the cache before redirecting', async function () {
        hookMocks.read.mockResolvedValue({ user: null })
        const sessionsAtNavigation: Array<
            AuthenticatedSessionQueryData | undefined
        > = []
        hookMocks.navigate.mockImplementation(async function () {
            sessionsAtNavigation.push(getSession())
        })
        mountActivityHook()
        await clock.advance(sessionConfig.idleDurationMs)
        expect(hookMocks.read).toHaveBeenCalledWith({
            signal: expect.any(AbortSignal),
        })
        expect(hookMocks.navigate).toHaveBeenCalledTimes(1)
        expect(hookMocks.navigate).toHaveBeenCalledWith({ to: '/login' })
        expect(sessionsAtNavigation).toEqual([{ user: null }])
        expect(getSession()).toEqual({ user: null })
        expect(hookMocks.logout).not.toHaveBeenCalled()
        expect(hookMocks.touch).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(0)
    })

    it('ignores a late GET denial after an actual newer QueryClient fetch succeeded', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        hookMocks.read.mockImplementation(() => pending.promise)
        mountActivityHook()
        await clock.advance(sessionConfig.idleDurationMs)
        const newer = createActivityTestSession({
            expiresAt: new Date(
                clock.wallNow() + sessionConfig.idleDurationMs,
            ).toISOString(),
            absoluteExpiresAt: new Date(
                clock.wallNow() + sessionConfig.absoluteDurationMs,
            ).toISOString(),
        })
        await hookMocks.queryClient.fetchQuery({
            queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
            queryFn: async () => newer,
            staleTime: 0,
        })
        const current = getSession()
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(getSession()).toBe(current)
        expect(getSession()).toEqual(newer)
        expect(hookMocks.navigate).not.toHaveBeenCalled()
        expect(hookMocks.logout).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(1)
    })

    it('uses a cache revision even when a successful query structurally shares the same object', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        hookMocks.read.mockImplementation(() => pending.promise)
        mountActivityHook()
        const original = getSession()
        await clock.advance(sessionConfig.idleDurationMs)
        await hookMocks.queryClient.fetchQuery({
            queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
            queryFn: async () => original,
            staleTime: 0,
        })
        expect(getSession()).toBe(original)
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(getSession()).toBe(original)
        expect(hookMocks.navigate).not.toHaveBeenCalled()
        expect(hookMocks.logout).not.toHaveBeenCalled()
    })

    it.each([
        { active: false },
        { active: true, expiresAt: '2026-09-06T12:00:00.000Z' },
        { active: true, expiresAt: '2026-09-06T12:20:00.000Z' },
    ] satisfies Array<SessionActivityTouchResult>)(
        'ignores a stale touch response after a fresh successful query %#',
        async function (result) {
            const pending = Promise.withResolvers<SessionActivityTouchResult>()
            hookMocks.touch.mockImplementation(() => pending.promise)
            mountActivityHook()
            target.emit('keydown')
            const newer = createActivityTestSession({
                expiresAt: '2026-09-06T12:25:00.000Z',
                absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
            })
            await hookMocks.queryClient.fetchQuery({
                queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
                queryFn: async () => newer,
                staleTime: 0,
            })
            const current = getSession()
            pending.resolve(result)
            await flushSessionActivityTasks()
            expect(getSession()).toBe(current)
            expect(getSession()).toEqual(newer)
            expect(hookMocks.read).not.toHaveBeenCalled()
            expect(hookMocks.navigate).not.toHaveBeenCalled()
            expect(hookMocks.logout).not.toHaveBeenCalled()
        },
    )

    it('does not reject a current touch due to unrelated query cache activity', async function () {
        const pending = Promise.withResolvers<SessionActivityTouchResult>()
        hookMocks.touch.mockImplementation(() => pending.promise)
        mountActivityHook()
        target.emit('keydown')
        hookMocks.queryClient.setQueryData(['unrelated'], { changed: true })
        hookMocks.queryClient.setQueryData(
            [...AUTHENTICATED_SESSION_QUERY_KEY, 'other-scope'],
            { user: null },
        )
        pending.resolve({ active: true, expiresAt: '2026-09-06T12:20:00.000Z' })
        await flushSessionActivityTasks()
        expect(getSession()?.expiresAt).toBe('2026-09-06T12:20:00.000Z')
        expect(hookMocks.touch).toHaveBeenCalledTimes(1)
        expect(hookMocks.read).not.toHaveBeenCalled()
        expect(hookMocks.navigate).not.toHaveBeenCalled()
    })

    it('does not recreate a removed session query from a pending successful touch', async function () {
        const pending = Promise.withResolvers<SessionActivityTouchResult>()
        hookMocks.touch.mockImplementation(() => pending.promise)
        mountActivityHook()
        target.emit('keydown')
        hookMocks.queryClient.removeQueries({
            queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
            exact: true,
        })
        pending.resolve({ active: true, expiresAt: '2026-09-06T12:20:00.000Z' })
        await flushSessionActivityTasks()
        expect(getSession()).toBeUndefined()
        expect(hookMocks.read).not.toHaveBeenCalled()
        expect(hookMocks.navigate).not.toHaveBeenCalled()
        expect(hookMocks.logout).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(0)
    })

    it('retains the last session and stops retrying after three failed reads', async function () {
        hookMocks.read.mockRejectedValue(new Error('network unavailable'))
        mountActivityHook()
        const original = getSession()
        await clock.advance(
            sessionConfig.idleDurationMs + 2 * sessionConfig.activityThrottleMs,
        )
        expect(hookMocks.read).toHaveBeenCalledTimes(3)
        expect(getSession()).toBe(original)
        expect(clock.pending.size).toBe(0)
        expect(hookMocks.navigate).not.toHaveBeenCalled()
        expect(hookMocks.logout).not.toHaveBeenCalled()
        expect(hookMocks.touch).not.toHaveBeenCalled()
    })

    it('cleans listeners, timers and cache subscription and ignores in-flight results after unmount', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        hookMocks.read.mockImplementation(() => pending.promise)
        mountActivityHook()
        await clock.advance(sessionConfig.idleDurationMs)
        const original = getSession()
        cleanup?.()
        cleanup = undefined
        expect(target.activeListenerCount).toBe(0)
        expect(clock.pending.size).toBe(0)
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(getSession()).toBe(original)
        expect(hookMocks.navigate).not.toHaveBeenCalled()
        setSession(
            createActivityTestSession({
                expiresAt: new Date(
                    clock.wallNow() + sessionConfig.idleDurationMs,
                ).toISOString(),
            }),
        )
        expect(clock.pending.size).toBe(0)
        target.emit('keydown')
        await clock.advance(sessionConfig.idleDurationMs)
        expect(hookMocks.read).toHaveBeenCalledTimes(1)
        expect(hookMocks.touch).not.toHaveBeenCalled()
        expect(hookMocks.logout).not.toHaveBeenCalled()
    })

    it('absorbs a router interruption without attempting server logout or retrying navigation', async function () {
        hookMocks.read.mockResolvedValue({ user: null })
        hookMocks.navigate.mockRejectedValue(new Error('navigation superseded'))
        mountActivityHook()
        await clock.advance(sessionConfig.idleDurationMs)
        await flushSessionActivityTasks()
        expect(getSession()).toEqual({ user: null })
        expect(hookMocks.navigate).toHaveBeenCalledTimes(1)
        expect(hookMocks.logout).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(0)
    })
})

describe('Session activity Hook request cancellation', function () {
    it('passes separate signals and keeps the new request alive while an old login request never settles', async function () {
        const oldRequest = Promise.withResolvers<SessionActivityTouchResult>()
        const newRequest = Promise.withResolvers<SessionActivityTouchResult>()
        hookMocks.touch.mockImplementationOnce(() => oldRequest.promise)
        hookMocks.touch.mockImplementationOnce(() => newRequest.promise)
        mountActivityHook()
        target.emit('keydown')
        const oldSignal = hookMocks.touch.mock.calls[0]?.[0].signal
        expect(oldSignal?.aborted).toBe(false)
        const newer = createActivityTestSession({
            absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
        })
        setSession(newer)
        expect(oldSignal?.aborted).toBe(true)
        target.emit('keydown')
        expect(hookMocks.touch).toHaveBeenCalledTimes(2)
        const newSignal = hookMocks.touch.mock.calls[1]?.[0].signal
        expect(newSignal).not.toBe(oldSignal)
        await flushSessionActivityTasks()
        expect(newSignal?.aborted).toBe(false)
        oldRequest.resolve({ active: false })
        await flushSessionActivityTasks()
        await clock.advance(sessionConfig.activityRequestTimeoutMs - 1)
        expect(newSignal?.aborted).toBe(false)
        expect(getSession()).toEqual(newer)
        expect(hookMocks.read).not.toHaveBeenCalled()
        expect(hookMocks.navigate).not.toHaveBeenCalled()
        expect(hookMocks.logout).not.toHaveBeenCalled()
        newRequest.resolve({
            active: true,
            expiresAt: '2026-09-06T12:20:00.000Z',
        })
        await flushSessionActivityTasks()
        expect(getSession()).toEqual({
            ...newer,
            expiresAt: '2026-09-06T12:20:00.000Z',
        })
        expect(clock.pending.size).toBe(1)
    })

    it('aborts a transport that ignores its signal and stops after the bounded GET recovery window', async function () {
        const oldRequest = Promise.withResolvers<SessionActivityTouchResult>()
        const pendingRead =
            Promise.withResolvers<AuthenticatedSessionQueryData>()
        hookMocks.touch.mockImplementation(() => oldRequest.promise)
        hookMocks.read.mockImplementation(() => pendingRead.promise)
        mountActivityHook()
        const original = getSession()
        target.emit('keydown')
        const signal = hookMocks.touch.mock.calls[0]?.[0].signal
        await clock.advance(sessionConfig.activityRequestTimeoutMs)
        expect(signal?.aborted).toBe(true)
        expect(hookMocks.read).toHaveBeenCalledTimes(1)
        await clock.advance(
            (sessionConfig.activityReadRetryLimit + 1) *
                sessionConfig.activityRequestTimeoutMs +
                sessionConfig.activityReadRetryLimit *
                    sessionConfig.activityThrottleMs,
        )
        expect(hookMocks.read).toHaveBeenCalledTimes(3)
        for (const [options] of hookMocks.read.mock.calls)
            expect(options.signal.aborted).toBe(true)
        expect(clock.pending.size).toBe(0)
        oldRequest.resolve({ active: false })
        pendingRead.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(getSession()).toBe(original)
        expect(hookMocks.read).toHaveBeenCalledTimes(3)
        expect(hookMocks.touch).toHaveBeenCalledTimes(1)
        expect(hookMocks.navigate).not.toHaveBeenCalled()
        expect(hookMocks.logout).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(0)
    })
})
