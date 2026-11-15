import * as actualReact from 'react'
import * as actualQuery from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { sessionConfig } from '@/config/session.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
    SYSTEM_SETTINGS_QUERY_KEY,
} from '@/lib/Queries/appQueries.ts'
import { AUTHENTICATED_SESSION_QUERY_KEY } from '@/lib/Queries/authenticatedSessionCache.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import type { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type { ActivityTestServerCallOptions } from './session-activity.test.types.ts'
import {
    createActivityTestClock,
    createActivityTestSession,
    flushSessionActivityTasks,
} from './session-activity.test.helpers.ts'

const actualReactExports = { ...actualReact }
const actualQueryExports = { ...actualQuery }
const websocketMocks = {
    queryClient: new actualQuery.QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    }),
    listener: null as Parameters<typeof subscribeToRealtimeEvents>[0] | null,
    navigate: vi.fn(async function () {}),
    read: vi.fn(async function (
        _options: ActivityTestServerCallOptions,
    ): Promise<AuthenticatedSessionQueryData> {
        return createActivityTestSession()
    }),
    logout: vi.fn(),
    reload: vi.fn(),
    unsubscribe: vi.fn(),
    resetTheme: vi.fn(),
    toast: vi.fn(),
    reconnect: vi.fn(),
    remember: vi.fn(),
}
let cleanup: (() => void) | undefined
let clock = createActivityTestClock()

vi.mock('react', function () {
    return {
        ...actualReactExports,
        useEffect(effect: actualReact.EffectCallback) {
            const dispose = effect()
            if (typeof dispose === 'function') cleanup = dispose
        },
    }
})
vi.mock('@tanstack/react-query', () => ({
    ...actualQueryExports,
    useQueryClient: () => websocketMocks.queryClient,
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => websocketMocks.navigate,
}))
vi.mock('@rentnerkev/toasts', () => ({
    toast: {
        error: websocketMocks.toast,
        info: websocketMocks.toast,
        success: websocketMocks.toast,
        warning: websocketMocks.toast,
    },
}))
vi.mock('@/features/Auth/middleware.ts', () => ({
    logoutHandler: websocketMocks.logout,
    validateSessionHandler: websocketMocks.read,
}))
vi.mock('@/features/Admin/SystemSettings/middleware.ts', () => ({
    getSystemSettingsHandler: vi.fn(),
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/Theme/appTheme.ts', () => ({
    resetAppThemeSettings: websocketMocks.resetTheme,
}))
vi.mock('@/lib/Browser/browser.ts', () => ({
    getCurrentBrowserPath: () => '/admin/users',
}))
vi.mock('@/lib/Maintenance/maintenanceReturnPath.ts', () => ({
    rememberMaintenanceReturnPath: websocketMocks.remember,
}))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    reconnectRealtimeEvents: websocketMocks.reconnect,
    subscribeToRealtimeEvents(
        listener: NonNullable<typeof websocketMocks.listener>,
    ) {
        websocketMocks.listener = listener
        return websocketMocks.unsubscribe
    },
}))

const { default: useAuthenticatedRealtimeEvents } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedRealtimeEvents.ts')

const revocations = [
    {
        type: 'user.sessions-revoked',
        payload: {
            userId: 'activity-user',
            revokedAt: '2026-09-06T12:00:00.000Z',
        },
    },
    {
        type: 'session.revoked',
        payload: {
            userId: 'activity-user',
            sessionHash: 'a'.repeat(64),
            revokedAt: '2026-09-06T12:00:00.000Z',
        },
    },
    {
        type: 'user.access-revoked',
        payload: {
            userId: 'activity-user',
            reason: 'deactivated',
            updatedAt: '2026-09-06T12:00:00.000Z',
        },
    },
] satisfies Array<RealtimeEvent>
const allSessionsRevoked = revocations[0]!

describe('Realtime cache and navigation events', () => {
    it('invalidates stale queries on connection and deduplicates delivered notifications', async () => {
        websocketMocks.queryClient.setQueryData(['stale-marker'], true)
        useAuthenticatedRealtimeEvents()
        await emit({
            type: 'connection.ready',
            payload: { connectedAt: '2026-09-06T12:00:00Z' },
        })
        expect(
            websocketMocks.queryClient.getQueryState(['stale-marker'])
                ?.isInvalidated,
        ).toBe(true)
        const notification = {
            id: 'notification-1',
            title: 'Notice',
            message: 'Synthetic message',
            type: 'info',
            referenceId: null,
            isRead: false,
            readAt: null,
            createdAt: '2026-09-06T12:00:00Z',
        }
        const event = {
            type: 'notification.created',
            payload: { userId: 'activity-user', notification },
        } satisfies RealtimeEvent
        await emit(event)
        await emit(event)
        expect(
            websocketMocks.queryClient.getQueryData(['notifications']),
        ).toEqual([notification])
        await emit({
            type: 'system-settings.updated',
            payload: {
                companyName: 'Updated company',
                updatedAt: '2026-09-06T12:00:00Z',
            },
        })
        expect(
            websocketMocks.queryClient.getQueryData(SYSTEM_SETTINGS_QUERY_KEY),
        ).toMatchObject({ companyName: 'Updated company' })
    })

    it.each([false, true])(
        'routes active maintenance only without bypass permission, bypass=%s',
        async (bypass) => {
            const session = createActivityTestSession()
            websocketMocks.queryClient.setQueryData(
                AUTHENTICATED_SESSION_QUERY_KEY,
                {
                    ...session,
                    permissions: bypass
                        ? [PERMISSIONS.ADMIN_MAINTENANCE_BYPASS]
                        : [],
                },
            )
            useAuthenticatedRealtimeEvents()
            await emit({
                type: 'maintenance-mode.changed',
                payload: {
                    isMaintenanceModeEnabled: true,
                    isMaintenanceModeActive: true,
                    isMaintenanceModeScheduled: false,
                    maintenanceStartsAt: null,
                    updatedAt: '2026-09-06T12:00:00Z',
                },
            })
            expect(websocketMocks.navigate).toHaveBeenCalledTimes(
                bypass ? 0 : 1,
            )
            if (!bypass)
                expect(websocketMocks.navigate).toHaveBeenCalledWith({
                    to: '/maintenance',
                    search: { redirect: '/admin/users' },
                })
            await emit({
                type: 'maintenance-mode.changed',
                payload: {
                    isMaintenanceModeEnabled: false,
                    isMaintenanceModeActive: false,
                    isMaintenanceModeScheduled: false,
                    maintenanceStartsAt: null,
                    updatedAt: '2026-09-06T12:00:01Z',
                },
            })
            expect(
                websocketMocks.queryClient.getQueryData(
                    SYSTEM_SETTINGS_QUERY_KEY,
                ),
            ).toMatchObject({
                pendingMaintenanceExtensionRequest: null,
                isMaintenanceModeEnabled: false,
            })
        },
    )

    it.each(['approved', 'rejected'] as const)(
        'updates maintenance timing and shows the requesting user the %s result',
        async (status) => {
            useAuthenticatedRealtimeEvents()
            await emit({
                type: 'maintenance-extension.resolved',
                payload: {
                    requestId: 'request-1',
                    userId: 'activity-user',
                    status,
                    maintenanceStartsAt: '2027-01-01T00:00:00Z',
                    resolvedAt: '2026-09-06T12:00:00Z',
                },
            })
            expect(
                websocketMocks.queryClient.getQueryData(
                    SYSTEM_SETTINGS_QUERY_KEY,
                ),
            ).toMatchObject({
                maintenanceStartsAt: '2027-01-01T00:00:00Z',
                isMaintenanceModeScheduled: true,
                isMaintenanceModeActive: false,
            })
            expect(
                websocketMocks.queryClient.getQueryData(
                    ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
                ),
            ).toMatchObject({ pendingMaintenanceExtensionRequest: null })
            expect(websocketMocks.toast).toHaveBeenCalledWith(
                status === 'approved'
                    ? 'maintenance.extensionApproved'
                    : 'maintenance.extensionRejected',
                expect.any(Object),
            )
        },
    )

    it('updates admin requests and hides another user’s resolution toast', async () => {
        const session = createActivityTestSession()
        websocketMocks.queryClient.setQueryData(
            AUTHENTICATED_SESSION_QUERY_KEY,
            { ...session, permissions: [PERMISSIONS.ADMIN_SYSTEM_SETTINGS] },
        )
        useAuthenticatedRealtimeEvents()
        const request = {
            id: 'request-2',
            reason: 'Finishing work before maintenance',
            requestedAt: '2026-09-06T12:00:00Z',
            user: { id: 'another-user', username: 'Other' },
        }
        await emit({
            type: 'maintenance-extension.requested',
            payload: { request },
        })
        expect(
            websocketMocks.queryClient.getQueryData(
                ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
            ),
        ).toMatchObject({ pendingMaintenanceExtensionRequest: request })
        expect(websocketMocks.toast).toHaveBeenCalledWith(
            'maintenance.adminExtensionRequested',
            expect.any(Object),
        )
        websocketMocks.toast.mockClear()
        await emit({
            type: 'maintenance-extension.resolved',
            payload: {
                requestId: request.id,
                userId: 'another-user',
                status: 'approved',
                maintenanceStartsAt: null,
                resolvedAt: '2026-09-06T12:00:00Z',
            },
        })
        expect(websocketMocks.toast).not.toHaveBeenCalled()
    })

    it('updates only the current user and reconnects after a permission topic change', async () => {
        useAuthenticatedRealtimeEvents()
        const event = {
            type: 'user.updated',
            payload: {
                userId: 'activity-user',
                username: 'New name',
                previousUsername: 'Old name',
                permissionKeys: [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
                previousPermissionKeys: [],
                addedPermissionKeys: [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
                removedPermissionKeys: [],
                updatedAt: '2026-09-06T12:00:00Z',
            },
        } satisfies RealtimeEvent
        await emit({
            ...event,
            payload: { ...event.payload, userId: 'other-user' },
        })
        expect(websocketMocks.toast).not.toHaveBeenCalled()
        await emit(event)
        expect(getSession()?.user?.username).toBe('New name')
        expect(getSession()).toMatchObject({
            permissions: [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
        })
        expect(websocketMocks.toast).toHaveBeenCalledTimes(2)
        expect(websocketMocks.reconnect).toHaveBeenCalledTimes(1)
    })
})

function getSession() {
    return websocketMocks.queryClient.getQueryData<AuthenticatedSessionQueryData>(
        AUTHENTICATED_SESSION_QUERY_KEY,
    )
}

async function emit(event: RealtimeEvent = allSessionsRevoked) {
    await websocketMocks.listener?.(event)
    await flushSessionActivityTasks()
}

beforeEach(function () {
    vi.clearAllMocks()
    cleanup = undefined
    clock = createActivityTestClock()
    websocketMocks.listener = null
    websocketMocks.queryClient = new actualQueryExports.QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    })
    websocketMocks.queryClient.setQueryData(
        AUTHENTICATED_SESSION_QUERY_KEY,
        createActivityTestSession(),
    )
    websocketMocks.read.mockImplementation(async () =>
        createActivityTestSession(),
    )
    websocketMocks.navigate.mockResolvedValue(undefined)
    vi.spyOn(Date, 'now').mockImplementation(clock.wallNow)
    vi.spyOn(performance, 'now').mockImplementation(clock.monotonicNow)
    const timers = new Map<number, () => void>()
    let nextTimer = 0
    stubTestGlobal('window', {
        location: { reload: websocketMocks.reload },
        setTimeout(callback: () => void, delayMs: number) {
            const id = ++nextTimer
            timers.set(
                id,
                clock.schedule(function () {
                    timers.delete(id)
                    callback()
                }, delayMs),
            )
            return id
        },
        clearTimeout(id: number) {
            timers.get(id)?.()
            timers.delete(id)
        },
    })
})

afterEach(function () {
    cleanup?.()
    websocketMocks.queryClient.clear()
    vi.restoreAllMocks()
    restoreTestGlobals()
})

describe('Restore-Reauth-WebSocket', function () {
    it('überlässt Restore-Navigation und Cachewechsel dem SPA-Statusflow', async function () {
        const original = getSession()
        useAuthenticatedRealtimeEvents()
        await emit({
            type: 'realtime.reauthentication-required',
            payload: {
                reason: 'restore',
                requestedAt: '2026-08-11T12:00:00.000Z',
            },
        })
        expect(websocketMocks.reload).not.toHaveBeenCalled()
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        expect(websocketMocks.read).not.toHaveBeenCalled()
        expect(getSession()).toBe(original)
    })
})

describe('Bounded current-session validation on realtime revocation', function () {
    it.each(revocations)(
        'keeps a current valid login after a delayed $type event',
        async function (event) {
            const newer = createActivityTestSession({
                absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
            })
            websocketMocks.queryClient.setQueryData(
                AUTHENTICATED_SESSION_QUERY_KEY,
                newer,
            )
            websocketMocks.read.mockResolvedValue(newer)
            websocketMocks.queryClient.setQueryData(['private-query'], {
                keep: true,
            })
            useAuthenticatedRealtimeEvents()
            await emit(event)
            expect(websocketMocks.read).toHaveBeenCalledTimes(1)
            expect(websocketMocks.read).toHaveBeenCalledWith({
                signal: expect.any(AbortSignal),
            })
            expect(getSession()).toEqual(newer)
            expect(
                websocketMocks.queryClient.getQueryData<
                    Record<string, boolean>
                >(['private-query']),
            ).toEqual({ keep: true })
            expect(websocketMocks.navigate).not.toHaveBeenCalled()
            expect(websocketMocks.resetTheme).not.toHaveBeenCalled()
            expect(websocketMocks.logout).not.toHaveBeenCalled()
        },
    )

    it.each(revocations)(
        'ends only a freshly confirmed invalid session after $type',
        async function (event) {
            const atNavigation: Array<unknown> = []
            websocketMocks.read.mockResolvedValue({ user: null })
            websocketMocks.queryClient.setQueryData(['private-query'], {
                old: true,
            })
            websocketMocks.navigate.mockImplementation(async function () {
                atNavigation.push(
                    getSession(),
                    websocketMocks.queryClient.getQueryData(['private-query']),
                )
            })
            useAuthenticatedRealtimeEvents()
            await emit(event)
            expect(websocketMocks.read).toHaveBeenCalledTimes(1)
            expect(getSession()).toEqual({ user: null })
            expect(atNavigation).toEqual([{ user: null }, undefined])
            expect(websocketMocks.navigate).toHaveBeenCalledTimes(1)
            expect(websocketMocks.navigate).toHaveBeenCalledWith({
                to: '/login',
            })
            expect(websocketMocks.resetTheme).toHaveBeenCalledTimes(1)
            expect(websocketMocks.logout).not.toHaveBeenCalled()
            expect(clock.pending.size).toBe(0)
        },
    )

    it('ignores another user and an event after the session cache was removed', async function () {
        useAuthenticatedRealtimeEvents()
        await emit({
            type: 'user.sessions-revoked',
            payload: {
                userId: 'other-user',
                revokedAt: '2026-09-06T12:00:00.000Z',
            },
        })
        websocketMocks.queryClient.removeQueries({
            queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
            exact: true,
        })
        await emit()
        expect(websocketMocks.read).not.toHaveBeenCalled()
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        expect(websocketMocks.logout).not.toHaveBeenCalled()
    })

    it('invalidates a pre-event GET for identical timestamps and coalesces a burst into one fresh check', async function () {
        const oldRead = Promise.withResolvers<AuthenticatedSessionQueryData>()
        websocketMocks.read.mockImplementationOnce(() => oldRead.promise)
        websocketMocks.read.mockResolvedValue({ user: null })
        useAuthenticatedRealtimeEvents()
        const original = getSession()
        await emit()
        const oldSignal = websocketMocks.read.mock.calls[0]?.[0].signal
        expect(oldSignal?.aborted).toBe(false)
        for (let index = 0; index < 1000; index += 1)
            void websocketMocks.listener?.(allSessionsRevoked)
        await flushSessionActivityTasks()
        expect(oldSignal?.aborted).toBe(true)
        expect(websocketMocks.read).toHaveBeenCalledTimes(1)
        expect(clock.pending.size).toBe(1)
        oldRead.resolve(
            createActivityTestSession({
                expiresAt: '2026-09-06T12:25:00.000Z',
            }),
        )
        await flushSessionActivityTasks()
        expect(getSession()).toBe(original)
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        await clock.advance(sessionConfig.activityThrottleMs - 1)
        expect(websocketMocks.read).toHaveBeenCalledTimes(1)
        await clock.advance(1)
        expect(websocketMocks.read).toHaveBeenCalledTimes(2)
        expect(getSession()).toEqual({ user: null })
        expect(websocketMocks.navigate).toHaveBeenCalledTimes(1)
        expect(websocketMocks.logout).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(0)
    })

    it('remembers one hint received during cooldown instead of losing the revocation', async function () {
        useAuthenticatedRealtimeEvents()
        await emit()
        expect(websocketMocks.read).toHaveBeenCalledTimes(1)
        websocketMocks.read.mockResolvedValue({ user: null })
        await clock.advance(1)
        await emit()
        await clock.advance(sessionConfig.activityThrottleMs - 2)
        expect(websocketMocks.read).toHaveBeenCalledTimes(1)
        expect(clock.pending.size).toBe(1)
        await clock.advance(1)
        expect(websocketMocks.read).toHaveBeenCalledTimes(2)
        expect(websocketMocks.navigate).toHaveBeenCalledTimes(1)
    })

    it('allows a same-user new session check immediately while the old request ignores abort', async function () {
        const oldRead = Promise.withResolvers<AuthenticatedSessionQueryData>()
        const newRead = Promise.withResolvers<AuthenticatedSessionQueryData>()
        websocketMocks.read.mockImplementationOnce(() => oldRead.promise)
        websocketMocks.read.mockImplementationOnce(() => newRead.promise)
        useAuthenticatedRealtimeEvents()
        await emit()
        const oldSignal = websocketMocks.read.mock.calls[0]?.[0].signal
        const newer = createActivityTestSession({
            absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
        })
        websocketMocks.queryClient.setQueryData(
            AUTHENTICATED_SESSION_QUERY_KEY,
            newer,
        )
        await emit()
        expect(websocketMocks.read).toHaveBeenCalledTimes(2)
        const newSignal = websocketMocks.read.mock.calls[1]?.[0].signal
        expect(oldSignal?.aborted).toBe(true)
        expect(newSignal?.aborted).toBe(false)
        oldRead.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(getSession()).toEqual(newer)
        expect(newSignal?.aborted).toBe(false)
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        newRead.resolve(newer)
        await flushSessionActivityTasks()
        expect(getSession()).toEqual(newer)
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        expect(websocketMocks.logout).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(0)
    })

    it('cannot overwrite a newer actual query success, including structural sharing', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        websocketMocks.read.mockImplementation(() => pending.promise)
        useAuthenticatedRealtimeEvents()
        const original = getSession()
        await emit()
        await websocketMocks.queryClient.invalidateQueries({
            queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
            exact: true,
            refetchType: 'none',
        })
        const readNewerSession = vi.fn(async () => original)
        await websocketMocks.queryClient.fetchQuery({
            queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
            staleTime: 0,
            queryFn: readNewerSession,
        })
        expect(readNewerSession).toHaveBeenCalledTimes(1)
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(getSession()).toBe(original)
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        expect(websocketMocks.logout).not.toHaveBeenCalled()
    })

    it('rechecks one known revocation after a same-session profile update invalidates the first read', async function () {
        const oldRead = Promise.withResolvers<AuthenticatedSessionQueryData>()
        websocketMocks.read.mockImplementationOnce(() => oldRead.promise)
        websocketMocks.read.mockResolvedValue({ user: null })
        useAuthenticatedRealtimeEvents()
        await emit()
        const original = getSession()
        if (!original?.user) throw new Error('Expected the synthetic session')
        const updated = {
            ...original,
            user: { ...original.user, username: 'updated profile' },
        }
        websocketMocks.queryClient.setQueryData(
            AUTHENTICATED_SESSION_QUERY_KEY,
            updated,
        )
        await flushSessionActivityTasks()
        expect(websocketMocks.read.mock.calls[0]?.[0].signal.aborted).toBe(true)
        expect(clock.pending.size).toBe(1)
        await clock.advance(sessionConfig.activityThrottleMs - 1)
        expect(websocketMocks.read).toHaveBeenCalledTimes(1)
        expect(getSession()).toEqual(updated)
        await clock.advance(1)
        expect(websocketMocks.read).toHaveBeenCalledTimes(2)
        expect(getSession()).toEqual({ user: null })
        expect(websocketMocks.navigate).toHaveBeenCalledTimes(1)
        expect(clock.pending.size).toBe(0)
        oldRead.resolve(original)
        await flushSessionActivityTasks()
        expect(getSession()).toEqual({ user: null })
        expect(websocketMocks.logout).not.toHaveBeenCalled()
    })

    it('bounds the automatic stale retry when same-session cache updates invalidate both reads', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        websocketMocks.read.mockImplementation(() => pending.promise)
        useAuthenticatedRealtimeEvents()
        await emit()
        const original = getSession()
        if (!original?.user) throw new Error('Expected the synthetic session')
        websocketMocks.queryClient.setQueryData(
            AUTHENTICATED_SESSION_QUERY_KEY,
            {
                ...original,
                user: { ...original.user, username: 'first profile update' },
            },
        )
        await flushSessionActivityTasks()
        await clock.advance(sessionConfig.activityThrottleMs)
        expect(websocketMocks.read).toHaveBeenCalledTimes(2)
        const updated = {
            ...original,
            user: { ...original.user, username: 'second profile update' },
        }
        websocketMocks.queryClient.setQueryData(
            AUTHENTICATED_SESSION_QUERY_KEY,
            updated,
        )
        await flushSessionActivityTasks()
        expect(clock.pending.size).toBe(0)
        await clock.advance(sessionConfig.idleDurationMs)
        expect(websocketMocks.read).toHaveBeenCalledTimes(2)
        expect(getSession()).toEqual(updated)
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(getSession()).toEqual(updated)
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        expect(websocketMocks.logout).not.toHaveBeenCalled()
    })

    it('bounds abort-ignoring burst requests and stops after the one pending check times out', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        websocketMocks.read.mockImplementation(() => pending.promise)
        useAuthenticatedRealtimeEvents()
        const original = getSession()
        await emit()
        for (let index = 0; index < 1000; index += 1)
            void websocketMocks.listener?.(allSessionsRevoked)
        await flushSessionActivityTasks()
        await clock.advance(
            sessionConfig.activityThrottleMs +
                sessionConfig.activityRequestTimeoutMs,
        )
        expect(websocketMocks.read).toHaveBeenCalledTimes(2)
        for (const [options] of websocketMocks.read.mock.calls)
            expect(options.signal.aborted).toBe(true)
        expect(clock.pending.size).toBe(0)
        await clock.advance(sessionConfig.idleDurationMs)
        expect(websocketMocks.read).toHaveBeenCalledTimes(2)
        expect(getSession()).toBe(original)
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        expect(websocketMocks.logout).not.toHaveBeenCalled()
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(getSession()).toBe(original)
    })

    it('preserves the current session on network failure and cleans up pending work on unmount', async function () {
        websocketMocks.read.mockRejectedValue(new Error('offline'))
        useAuthenticatedRealtimeEvents()
        const original = getSession()
        await emit()
        expect(getSession()).toBe(original)
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        await emit()
        expect(clock.pending.size).toBe(1)
        cleanup?.()
        cleanup = undefined
        await clock.advance(sessionConfig.activityThrottleMs)
        expect(websocketMocks.unsubscribe).toHaveBeenCalledTimes(1)
        expect(websocketMocks.read).toHaveBeenCalledTimes(1)
        expect(websocketMocks.logout).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(0)
    })

    it('aborts an in-flight read on unmount without touching a replacement session', async function () {
        const pending = Promise.withResolvers<AuthenticatedSessionQueryData>()
        websocketMocks.read.mockImplementation(() => pending.promise)
        useAuthenticatedRealtimeEvents()
        await emit()
        const signal = websocketMocks.read.mock.calls[0]?.[0].signal
        cleanup?.()
        cleanup = undefined
        const newer = createActivityTestSession({
            absoluteExpiresAt: '2026-09-06T21:00:00.000Z',
        })
        websocketMocks.queryClient.setQueryData(
            AUTHENTICATED_SESSION_QUERY_KEY,
            newer,
        )
        pending.resolve({ user: null })
        await flushSessionActivityTasks()
        expect(signal?.aborted).toBe(true)
        expect(getSession()).toEqual(newer)
        expect(websocketMocks.navigate).not.toHaveBeenCalled()
        expect(websocketMocks.logout).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(0)
    })
})
