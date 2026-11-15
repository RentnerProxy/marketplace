import { afterEach, describe, expect, it } from 'bun:test'
import { sessionConfig } from '@/config/session.config.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type { SessionActivityTouchResult } from '@/lib/Auth/Session/Types/session-activity.types.ts'
import type { SessionActivityHarnessOptions } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.types.ts'
import {
    createActivityTestSession,
    createSessionActivityHarness,
    flushSessionActivityTasks,
    SESSION_ACTIVITY_TEST_NOW,
} from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'

const activeHarnesses: Array<ReturnType<typeof createSessionActivityHarness>> =
    []

function harness(options?: SessionActivityHarnessOptions) {
    const result = createSessionActivityHarness(options)
    activeHarnesses.push(result)
    return result
}

afterEach(function () {
    for (const test of activeHarnesses.splice(0)) test.controller.dispose()
})

describe('Session activity input', function () {
    it.each(['pointerdown', 'keydown', 'wheel', 'touchstart'])(
        'extends once for a visible trusted %s event',
        async function (type) {
            const test = harness()
            expect(test.touchSession).not.toHaveBeenCalled()
            expect(test.readSession).not.toHaveBeenCalled()
            test.target.emit(type)
            await flushSessionActivityTasks()
            expect(test.touchSession).toHaveBeenCalledTimes(1)
            expect(test.readSession).not.toHaveBeenCalled()
            expect(test.onInactive).not.toHaveBeenCalled()
        },
    )

    it.each(['pointerdown', 'keydown', 'wheel', 'touchstart'])(
        'ignores native synthetic %s events',
        async function (type) {
            const test = harness()
            test.target.emit(type, false)
            await flushSessionActivityTasks()
            expect(test.touchSession).not.toHaveBeenCalled()
            expect(test.readSession).not.toHaveBeenCalled()
        },
    )

    it('ignores hidden inputs and non-activity events without consuming the next visible attempt', async function () {
        const test = harness()
        test.target.visibilityState = 'hidden'
        for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
            test.target.emit(event)
        test.target.visibilityState = 'visible'
        for (const event of [
            'visibilitychange',
            'focus',
            'mousemove',
            'pointermove',
            'scroll',
            'prefetch',
        ]) {
            test.target.emit(event)
        }
        await flushSessionActivityTasks()
        expect(test.touchSession).not.toHaveBeenCalled()
        expect(test.readSession).not.toHaveBeenCalled()
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
    })

    it('uses passive capturing listeners and removes exactly those listeners on disposal', async function () {
        const test = harness()
        expect(test.target.registrations).toEqual(
            ['pointerdown', 'keydown', 'wheel', 'touchstart'].map((type) => ({
                type,
                options: { passive: true, capture: true },
            })),
        )
        expect(test.target.activeListenerCount).toBe(4)
        test.controller.dispose()
        test.controller.dispose()
        expect(test.target.activeListenerCount).toBe(0)
        expect(test.clock.pending.size).toBe(0)
        test.target.emit('keydown')
        test.target.emit('keydown', false)
        await test.clock.advance(sessionConfig.idleDurationMs)
        expect(test.touchSession).not.toHaveBeenCalled()
        expect(test.readSession).not.toHaveBeenCalled()
    })

    it('coalesces bursts without a trailing POST and permits the next attempt only after a monotonic minute', async function () {
        const test = harness()
        for (let index = 0; index < 1000; index += 1)
            test.target.emit('pointerdown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        await test.clock.advance(sessionConfig.activityThrottleMs - 1)
        test.target.emit('touchstart')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        await test.clock.advance(1)
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(2)
    })

    it('does not bypass activity throttling when the wall clock jumps', async function () {
        const test = harness()
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        test.clock.jumpWall(-sessionConfig.absoluteDurationMs)
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        await test.clock.advance(sessionConfig.activityThrottleMs)
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(2)
    })

    it('keeps one request in flight and never queues dropped activity', async function () {
        const deferred = Promise.withResolvers<SessionActivityTouchResult>()
        const test = harness({ touchSession: () => deferred.promise })
        test.target.emit('pointerdown')
        await test.clock.advance(sessionConfig.activityRequestTimeoutMs - 1)
        test.target.emit('keydown')
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        expect(test.readSession).not.toHaveBeenCalled()
        deferred.resolve({
            active: true,
            expiresAt: new Date(
                test.clock.wallNow() + sessionConfig.idleDurationMs,
            ).toISOString(),
        })
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        await test.clock.advance(
            sessionConfig.activityThrottleMs -
                sessionConfig.activityRequestTimeoutMs +
                1,
        )
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(2)
    })
})

describe('Session activity deadlines and server evidence', function () {
    it('preserves user, permission and absolute deadline data after an active touch', async function () {
        const test = harness()
        const original = test.getSession()
        if (!original) throw new Error('Missing initial test session')
        await test.clock.advance(sessionConfig.activityThrottleMs)
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.getSession()).toEqual({
            ...original,
            expiresAt: new Date(
                test.clock.wallNow() + sessionConfig.idleDurationMs,
            ).toISOString(),
        })
        expect(test.getSession()?.user).toBe(original?.user)
        expect(test.getSession()?.permissions).toBe(original?.permissions)
        expect(test.commitSession).toHaveBeenCalledTimes(1)
        expect(test.clock.pending.size).toBe(1)
        await test.clock.advance(sessionConfig.idleDurationMs - 1)
        expect(test.readSession).not.toHaveBeenCalled()
        await test.clock.advance(1)
        expect(test.readSession).toHaveBeenCalledTimes(1)
        expect(test.touchSession).toHaveBeenCalledTimes(1)
    })

    it('rechecks passive expiry with GET and retains a session extended by another tab', async function () {
        const test = harness()
        await test.clock.advance(sessionConfig.idleDurationMs)
        expect(test.touchSession).not.toHaveBeenCalled()
        expect(test.readSession).toHaveBeenCalledTimes(1)
        expect(test.getSession()?.expiresAt).toBe(
            new Date(
                test.clock.wallNow() + sessionConfig.idleDurationMs,
            ).toISOString(),
        )
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(1)
    })

    it('commits a current server-confirmed missing session before navigating once', async function () {
        const test = harness({ readSession: async () => ({ user: null }) })
        await test.clock.advance(sessionConfig.idleDurationMs)
        expect(test.getSession()).toEqual({ user: null })
        expect(test.commitSession).toHaveBeenCalledTimes(1)
        expect(test.onInactive).toHaveBeenCalledTimes(1)
        expect(test.clock.pending.size).toBe(0)
        await test.clock.advance(sessionConfig.absoluteDurationMs)
        test.target.emit('keydown')
        expect(test.readSession).toHaveBeenCalledTimes(1)
        expect(test.touchSession).not.toHaveBeenCalled()
        expect(test.onInactive).toHaveBeenCalledTimes(1)
    })

    it('does not regard active=false from POST alone as permission to end the client session', async function () {
        const read = Promise.withResolvers<AuthenticatedSessionQueryData>()
        const test = harness({
            touchSession: async () => ({ active: false }),
            readSession: () => read.promise,
        })
        const original = test.getSession()
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.readSession).toHaveBeenCalledTimes(1)
        expect(test.getSession()).toBe(original)
        expect(test.onInactive).not.toHaveBeenCalled()
        read.resolve(createActivityTestSession())
        await flushSessionActivityTasks()
        expect(test.getSession()?.user).not.toBeNull()
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
    })

    it('requires a current GET denial after an inactive POST', async function () {
        const test = harness({
            touchSession: async () => ({ active: false }),
            readSession: async () => ({ user: null }),
        })
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        expect(test.readSession).toHaveBeenCalledTimes(1)
        expect(test.getSession()).toEqual({ user: null })
        expect(test.onInactive).toHaveBeenCalledTimes(1)
    })

    it('uses only GET on local expiry and never auto-touches a newly refreshed session', async function () {
        const test = harness({
            session: createActivityTestSession({
                expiresAt: new Date(SESSION_ACTIVITY_TEST_NOW).toISOString(),
            }),
        })
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.readSession).toHaveBeenCalledTimes(1)
        expect(test.touchSession).not.toHaveBeenCalled()
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).not.toHaveBeenCalled()
        await test.clock.advance(sessionConfig.activityThrottleMs)
        expect(test.touchSession).not.toHaveBeenCalled()
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
    })

    it('never sends activity POST after the absolute deadline', async function () {
        const expiry = new Date(SESSION_ACTIVITY_TEST_NOW).toISOString()
        const test = harness({
            session: createActivityTestSession({
                expiresAt: expiry,
                absoluteExpiresAt: expiry,
            }),
            readSession: async () => ({ user: null }),
        })
        test.target.emit('pointerdown')
        await flushSessionActivityTasks()
        expect(test.touchSession).not.toHaveBeenCalled()
        expect(test.readSession).toHaveBeenCalledTimes(1)
        expect(test.onInactive).toHaveBeenCalledTimes(1)
    })

    it.each([
        'invalid',
        '2026-09-06T12:10:00Z',
        '2026-09-06T12:00:00.000Z',
        '2026-09-07T12:00:00.000Z',
    ])(
        'rechecks an unusable touch expiry %s without writing it to the cache',
        async function (expiresAt) {
            const read = Promise.withResolvers<AuthenticatedSessionQueryData>()
            const test = harness({
                touchSession: async () => ({ active: true, expiresAt }),
                readSession: () => read.promise,
            })
            const original = test.getSession()
            test.target.emit('keydown')
            await flushSessionActivityTasks()
            expect(test.readSession).toHaveBeenCalledTimes(1)
            expect(test.getSession()).toBe(original)
            expect(test.commitSession).not.toHaveBeenCalled()
            expect(test.onInactive).not.toHaveBeenCalled()
            read.resolve(createActivityTestSession())
            await flushSessionActivityTasks()
        },
    )
})

describe('Session activity bounded read recovery', function () {
    it('retries a failed passive read only twice, retains cache and stops all timers', async function () {
        const test = harness({
            readSession: async () => {
                throw new Error('offline')
            },
        })
        const original = test.getSession()
        await test.clock.advance(sessionConfig.idleDurationMs)
        expect(test.readSession).toHaveBeenCalledTimes(1)
        await test.clock.advance(sessionConfig.activityThrottleMs - 1)
        expect(test.readSession).toHaveBeenCalledTimes(1)
        await test.clock.advance(1)
        expect(test.readSession).toHaveBeenCalledTimes(2)
        await test.clock.advance(sessionConfig.activityThrottleMs)
        expect(test.readSession).toHaveBeenCalledTimes(3)
        expect(test.clock.pending.size).toBe(0)
        await test.clock.advance(sessionConfig.absoluteDurationMs)
        expect(test.readSession).toHaveBeenCalledTimes(3)
        expect(test.touchSession).not.toHaveBeenCalled()
        expect(test.getSession()).toBe(original)
        expect(test.onInactive).not.toHaveBeenCalled()
    })

    it('bounds failed GET recovery after a network-failed POST even while the old deadline is still future', async function () {
        const test = harness({
            touchSession: async () => {
                throw new Error('lost POST response')
            },
            readSession: async () => {
                throw new Error('offline')
            },
        })
        const original = test.getSession()
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        await test.clock.advance(2 * sessionConfig.activityThrottleMs)
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        expect(test.readSession).toHaveBeenCalledTimes(3)
        expect(test.clock.pending.size).toBe(0)
        expect(test.getSession()).toBe(original)
        expect(test.onInactive).not.toHaveBeenCalled()
    })

    it.each([
        { expiresAt: undefined, absoluteExpiresAt: undefined },
        { expiresAt: 'unreadable' },
        { absoluteExpiresAt: 'unreadable' },
        { expiresAt: '2026-09-07T12:00:00.000Z' },
    ])(
        'bounds reads for unavailable or malformed cached deadlines %#',
        async function (overrides) {
            const legacy = createActivityTestSession(overrides)
            const test = harness({
                session: legacy,
                readSession: async () => legacy,
            })
            await test.clock.advance(0)
            expect(test.readSession).toHaveBeenCalledTimes(1)
            await test.clock.advance(2 * sessionConfig.activityThrottleMs)
            expect(test.readSession).toHaveBeenCalledTimes(3)
            expect(test.clock.pending.size).toBe(0)
            expect(test.touchSession).not.toHaveBeenCalled()
            expect(test.onInactive).not.toHaveBeenCalled()
        },
    )

    it('does not loop when valid server dates appear expired on a fast client clock', async function () {
        const expired = createActivityTestSession({
            expiresAt: new Date(SESSION_ACTIVITY_TEST_NOW).toISOString(),
        })
        const test = harness({
            session: expired,
            readSession: async () => ({ ...expired }),
        })
        await test.clock.advance(2 * sessionConfig.activityThrottleMs)
        expect(test.readSession).toHaveBeenCalledTimes(3)
        expect(test.clock.pending.size).toBe(0)
        expect(test.getSession()?.user).not.toBeNull()
        expect(test.onInactive).not.toHaveBeenCalled()
    })

    it('permits a bounded new GET sequence on later genuine activity after recovery stopped', async function () {
        const test = harness({
            readSession: async () => {
                throw new Error('offline')
            },
        })
        await test.clock.advance(
            sessionConfig.idleDurationMs + 2 * sessionConfig.activityThrottleMs,
        )
        expect(test.clock.pending.size).toBe(0)
        test.readSession.mockResolvedValue(
            createActivityTestSession({
                expiresAt: new Date(
                    test.clock.wallNow() + sessionConfig.idleDurationMs,
                ).toISOString(),
            }),
        )
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.readSession).toHaveBeenCalledTimes(4)
        expect(test.touchSession).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(1)
        expect(test.onInactive).not.toHaveBeenCalled()
    })
})

describe('Session activity stale responses and lifecycle', function () {
    it.each([
        { active: false },
        { active: true, expiresAt: '2026-09-06T12:00:00.000Z' },
        { active: true, expiresAt: '2026-09-06T12:20:00.000Z' },
    ] satisfies Array<SessionActivityTouchResult>)(
        'ignores a stale touch response after a newer successful session query %#',
        async function (result) {
            const pending = Promise.withResolvers<SessionActivityTouchResult>()
            const test = harness({ touchSession: () => pending.promise })
            test.target.emit('keydown')
            const newer = createActivityTestSession({
                expiresAt: '2026-09-06T12:25:00.000Z',
                absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
            })
            test.setSession(newer)
            pending.resolve(result)
            await flushSessionActivityTasks()
            expect(test.getSession()).toBe(newer)
            expect(test.commitSession).not.toHaveBeenCalled()
            expect(test.readSession).not.toHaveBeenCalled()
            expect(test.onInactive).not.toHaveBeenCalled()
            expect(test.clock.pending.size).toBe(1)
        },
    )

    it.each([{ user: null }, createActivityTestSession()])(
        'ignores an old GET result after a new login of the same user %#',
        async function (result) {
            const pending =
                Promise.withResolvers<AuthenticatedSessionQueryData>()
            const test = harness({ readSession: () => pending.promise })
            await test.clock.advance(sessionConfig.idleDurationMs)
            const newer = createActivityTestSession({
                expiresAt: new Date(
                    test.clock.wallNow() + sessionConfig.idleDurationMs,
                ).toISOString(),
                absoluteExpiresAt: new Date(
                    test.clock.wallNow() + sessionConfig.absoluteDurationMs,
                ).toISOString(),
            })
            test.setSession(newer)
            pending.resolve(result)
            await flushSessionActivityTasks()
            expect(test.getSession()).toBe(newer)
            expect(test.commitSession).not.toHaveBeenCalled()
            expect(test.onInactive).not.toHaveBeenCalled()
            expect(test.clock.pending.size).toBe(1)
        },
    )

    it('rejects a stale GET even when the newer query reused the exact same data object', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        const test = harness({ readSession: () => pending.promise })
        await test.clock.advance(sessionConfig.idleDurationMs)
        const original = test.getSession()
        test.setSession(original)
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(test.getSession()).toBe(original)
        expect(test.commitSession).not.toHaveBeenCalled()
        expect(test.onInactive).not.toHaveBeenCalled()
    })

    it('never resurrects a removed query from a pending touch', async function () {
        const pending = Promise.withResolvers<SessionActivityTouchResult>()
        const test = harness({ touchSession: () => pending.promise })
        test.target.emit('keydown')
        test.setSession(undefined)
        pending.resolve({ active: true, expiresAt: '2026-09-06T12:20:00.000Z' })
        await flushSessionActivityTasks()
        expect(test.getSession()).toBeUndefined()
        expect(test.commitSession).not.toHaveBeenCalled()
        expect(test.readSession).not.toHaveBeenCalled()
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
    })

    it('ignores a pending GET after disposal and leaves no callbacks or listeners', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        const test = harness({ readSession: () => pending.promise })
        await test.clock.advance(sessionConfig.idleDurationMs)
        const original = test.getSession()
        test.controller.dispose()
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(test.getSession()).toBe(original)
        expect(test.commitSession).not.toHaveBeenCalled()
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
        expect(test.target.activeListenerCount).toBe(0)
    })

    it('ignores a pending inactive touch after disposal without starting a follow-up read', async function () {
        const pending = Promise.withResolvers<SessionActivityTouchResult>()
        const test = harness({ touchSession: () => pending.promise })
        const original = test.getSession()
        test.target.emit('keydown')
        test.controller.dispose()
        pending.resolve({ active: false })
        await flushSessionActivityTasks()
        expect(test.getSession()).toBe(original)
        expect(test.readSession).not.toHaveBeenCalled()
        expect(test.commitSession).not.toHaveBeenCalled()
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
    })

    it('starts no work for an absent session until a later cache update supplies deadlines', async function () {
        const test = harness({ session: { user: null } })
        test.target.emit('keydown')
        await test.clock.advance(sessionConfig.idleDurationMs)
        expect(test.touchSession).not.toHaveBeenCalled()
        expect(test.readSession).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
        test.setSession(
            createActivityTestSession({
                expiresAt: new Date(
                    test.clock.wallNow() + sessionConfig.idleDurationMs,
                ).toISOString(),
            }),
        )
        expect(test.clock.pending.size).toBe(1)
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
    })

    it('does not navigate when the cache compare-and-swap rejects a current GET denial', async function () {
        const test = harness({ readSession: async () => ({ user: null }) })
        const original = test.getSession()
        test.commitSession.mockReturnValue(false)
        await test.clock.advance(sessionConfig.idleDurationMs)
        expect(test.commitSession).toHaveBeenCalledTimes(1)
        expect(test.getSession()).toBe(original)
        expect(test.onInactive).not.toHaveBeenCalled()
    })
})

describe('Session activity request generations and cancellation', function () {
    it.each([
        { active: false },
        { active: true, expiresAt: '2026-09-06T12:00:00.000Z' },
        { active: true, expiresAt: '2026-09-06T12:20:00.000Z' },
    ] satisfies Array<SessionActivityTouchResult>)(
        'allows the same user new session to touch before the old response settles %#',
        async function (oldResult) {
            const oldRequest =
                Promise.withResolvers<SessionActivityTouchResult>()
            const newRequest =
                Promise.withResolvers<SessionActivityTouchResult>()
            const test = harness()
            test.touchSession.mockImplementationOnce(() => oldRequest.promise)
            test.touchSession.mockImplementationOnce(() => newRequest.promise)
            test.target.emit('keydown')
            const oldSignal = test.touchSession.mock.calls[0]?.[0]
            expect(oldSignal?.aborted).toBe(false)
            const newer = createActivityTestSession({
                expiresAt: '2026-09-06T12:25:00.000Z',
                absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
            })
            test.setSession(newer)
            expect(oldSignal?.aborted).toBe(true)
            test.target.emit('keydown')
            expect(test.touchSession).toHaveBeenCalledTimes(2)
            const newSignal = test.touchSession.mock.calls[1]?.[0]
            expect(newSignal?.aborted).toBe(false)
            await flushSessionActivityTasks()
            expect(newSignal?.aborted).toBe(false)
            expect(test.clock.pending.size).toBe(1)
            oldRequest.resolve(oldResult)
            await flushSessionActivityTasks()
            expect(test.getSession()).toBe(newer)
            expect(test.readSession).not.toHaveBeenCalled()
            expect(test.onInactive).not.toHaveBeenCalled()
            expect(newSignal?.aborted).toBe(false)
            test.target.emit('keydown')
            expect(test.touchSession).toHaveBeenCalledTimes(2)
            await test.clock.advance(sessionConfig.activityRequestTimeoutMs - 1)
            expect(newSignal?.aborted).toBe(false)
            expect(test.readSession).not.toHaveBeenCalled()
            newRequest.resolve({
                active: true,
                expiresAt: '2026-09-06T12:25:00.000Z',
            })
            await flushSessionActivityTasks()
            expect(test.getSession()).toEqual(newer)
            expect(test.clock.pending.size).toBe(1)
            expect(test.onInactive).not.toHaveBeenCalled()
        },
    )

    it('allows the new session passive GET while the old GET promise remains unresolved', async function () {
        const oldRead = Promise.withResolvers<AuthenticatedSessionQueryData>()
        const newRead = Promise.withResolvers<AuthenticatedSessionQueryData>()
        const test = harness({
            session: createActivityTestSession({
                expiresAt: '2026-09-06T12:00:00.000Z',
            }),
        })
        test.readSession.mockImplementationOnce(() => oldRead.promise)
        test.readSession.mockImplementationOnce(() => newRead.promise)
        await test.clock.advance(0)
        const oldSignal = test.readSession.mock.calls[0]?.[0]
        expect(test.readSession).toHaveBeenCalledTimes(1)
        const newer = createActivityTestSession({
            absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
        })
        test.setSession(newer)
        expect(oldSignal?.aborted).toBe(true)
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        await test.clock.advance(sessionConfig.idleDurationMs)
        expect(test.readSession).toHaveBeenCalledTimes(2)
        const newSignal = test.readSession.mock.calls[1]?.[0]
        expect(newSignal?.aborted).toBe(false)
        oldRead.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(newSignal?.aborted).toBe(false)
        expect(test.getSession()?.user).not.toBeNull()
        expect(test.onInactive).not.toHaveBeenCalled()
        newRead.resolve({
            ...newer,
            expiresAt: new Date(
                test.clock.wallNow() + sessionConfig.idleDurationMs,
            ).toISOString(),
        })
        await flushSessionActivityTasks()
        expect(test.getSession()?.absoluteExpiresAt).toBe(
            newer.absoluteExpiresAt,
        )
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(1)
    })

    it('invalidates an old request when the user changes with unchanged deadline fields', async function () {
        const oldRequest = Promise.withResolvers<SessionActivityTouchResult>()
        const test = harness()
        test.touchSession.mockImplementationOnce(() => oldRequest.promise)
        test.target.emit('keydown')
        const priorUser = test.getSession()?.user
        if (!priorUser) throw new Error('Missing initial test user')
        const other = createActivityTestSession({
            user: {
                ...priorUser,
                id: 'different-user',
                username: 'different-user',
            },
        })
        test.setSession(other)
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(2)
        expect(test.touchSession.mock.calls[0]?.[0].aborted).toBe(true)
        expect(test.getSession()?.user).toEqual(other.user)
        oldRequest.resolve({ active: false })
        await flushSessionActivityTasks()
        expect(test.getSession()?.user).toEqual(other.user)
        expect(test.readSession).not.toHaveBeenCalled()
        expect(test.onInactive).not.toHaveBeenCalled()
    })

    it('aborts on cache removal and allows the same session object to mount again without waiting', async function () {
        const oldRequest = Promise.withResolvers<SessionActivityTouchResult>()
        const newRequest = Promise.withResolvers<SessionActivityTouchResult>()
        const test = harness()
        test.touchSession.mockImplementationOnce(() => oldRequest.promise)
        test.touchSession.mockImplementationOnce(() => newRequest.promise)
        const original = test.getSession()
        test.target.emit('keydown')
        test.setSession(undefined)
        expect(test.touchSession.mock.calls[0]?.[0].aborted).toBe(true)
        expect(test.clock.pending.size).toBe(0)
        test.setSession(original)
        test.target.emit('keydown')
        expect(test.touchSession).toHaveBeenCalledTimes(2)
        const newSignal = test.touchSession.mock.calls[1]?.[0]
        await flushSessionActivityTasks()
        expect(newSignal?.aborted).toBe(false)
        oldRequest.resolve({ active: false })
        await flushSessionActivityTasks()
        expect(test.getSession()).toBe(original)
        expect(newSignal?.aborted).toBe(false)
        expect(test.clock.pending.size).toBe(1)
        expect(test.readSession).not.toHaveBeenCalled()
        newRequest.resolve({
            active: true,
            expiresAt: '2026-09-06T12:20:00.000Z',
        })
        await flushSessionActivityTasks()
        expect(test.getSession()?.expiresAt).toBe('2026-09-06T12:20:00.000Z')
        expect(test.onInactive).not.toHaveBeenCalled()
    })

    it('does not spawn parallel requests or reset the request timeout for ordinary cache refreshes', async function () {
        const pending = Promise.withResolvers<SessionActivityTouchResult>()
        const test = harness({ touchSession: () => pending.promise })
        test.target.emit('keydown')
        const signal = test.touchSession.mock.calls[0]?.[0]
        await test.clock.advance(sessionConfig.activityRequestTimeoutMs - 1)
        for (let count = 0; count < 100; count += 1) {
            test.setSession(createActivityTestSession())
            test.target.emit('keydown')
        }
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        expect(test.readSession).not.toHaveBeenCalled()
        expect(signal?.aborted).toBe(false)
        expect(test.clock.pending.size).toBe(1)
        await test.clock.advance(1)
        expect(signal?.aborted).toBe(true)
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        expect(test.readSession).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(1)
        pending.resolve({ active: false })
        await flushSessionActivityTasks()
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.readSession).not.toHaveBeenCalled()
    })

    it('releases an abort-ignoring POST and bounds abort-ignoring GET recovery to three attempts', async function () {
        const post = Promise.withResolvers<SessionActivityTouchResult>()
        const read = Promise.withResolvers<AuthenticatedSessionQueryData>()
        const test = harness({
            touchSession: () => post.promise,
            readSession: () => read.promise,
        })
        const original = test.getSession()
        test.target.emit('keydown')
        await test.clock.advance(sessionConfig.activityRequestTimeoutMs - 1)
        expect(test.touchSession.mock.calls[0]?.[0].aborted).toBe(false)
        expect(test.readSession).not.toHaveBeenCalled()
        await test.clock.advance(1)
        expect(test.touchSession.mock.calls[0]?.[0].aborted).toBe(true)
        expect(test.readSession).toHaveBeenCalledTimes(1)
        expect(test.readSession.mock.calls[0]?.[0].aborted).toBe(false)
        await test.clock.advance(
            (sessionConfig.activityReadRetryLimit + 1) *
                sessionConfig.activityRequestTimeoutMs +
                sessionConfig.activityReadRetryLimit *
                    sessionConfig.activityThrottleMs,
        )
        expect(test.readSession).toHaveBeenCalledTimes(3)
        for (const [signal] of test.readSession.mock.calls)
            expect(signal.aborted).toBe(true)
        expect(test.clock.pending.size).toBe(0)
        expect(test.getSession()).toBe(original)
        expect(test.onInactive).not.toHaveBeenCalled()
        post.resolve({ active: false })
        read.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(test.getSession()).toBe(original)
        expect(test.readSession).toHaveBeenCalledTimes(3)
        expect(test.touchSession).toHaveBeenCalledTimes(1)
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
        test.touchSession.mockResolvedValue({
            active: true,
            expiresAt: new Date(
                test.clock.wallNow() + sessionConfig.idleDurationMs,
            ).toISOString(),
        })
        test.target.emit('keydown')
        await flushSessionActivityTasks()
        expect(test.touchSession).toHaveBeenCalledTimes(2)
        expect(test.clock.pending.size).toBe(1)
    })

    it('aborts the current transport on disposal without scheduling recovery', async function () {
        const pending = Promise.withResolvers<SessionActivityTouchResult>()
        const test = harness({ touchSession: () => pending.promise })
        const original = test.getSession()
        test.target.emit('keydown')
        const signal = test.touchSession.mock.calls[0]?.[0]
        expect(signal?.aborted).toBe(false)
        test.controller.dispose()
        expect(signal?.aborted).toBe(true)
        expect(test.clock.pending.size).toBe(0)
        await test.clock.advance(sessionConfig.activityRequestTimeoutMs)
        pending.resolve({ active: false })
        await flushSessionActivityTasks()
        expect(test.getSession()).toBe(original)
        expect(test.readSession).not.toHaveBeenCalled()
        expect(test.onInactive).not.toHaveBeenCalled()
        expect(test.clock.pending.size).toBe(0)
    })
})
