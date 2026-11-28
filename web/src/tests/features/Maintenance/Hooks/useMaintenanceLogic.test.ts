import { QueryClient } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '@/tests/layouts/hook-harness.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import type { MaintenancePageStatus } from '@/features/Maintenance/Types/types.ts'

const client = new QueryClient()
const navigate = vi.fn(async (_options: unknown) => undefined)
const clearReturn = vi.fn()
const bridge = vi.fn()
const success = vi.fn()
const errorToast = vi.fn()
const unsubscribe = vi.fn()
let status: MaintenancePageStatus | undefined
let searchRedirect: string | undefined
let storedPath: string | null
let listener: ((event: RealtimeEvent) => Promise<void>) | undefined
vi.mock('react', () => ({
    ...hookReact,
    useCallback: <T>(callback: T) => callback,
}))
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => client,
    useQuery: () => ({ data: status, isPending: false }),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useSearch: () => ({ redirect: searchRedirect }),
}))
vi.mock('@/features/Maintenance/middleware.ts', () => ({
    getMaintenancePageStatusHandler: vi.fn(),
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/Maintenance/maintenanceReturnPath.ts', () => ({
    getStoredMaintenanceReturnPath: () => storedPath,
    clearStoredMaintenanceReturnPath: clearReturn,
}))
vi.mock('@/shared/Restore/Hooks/useRestoreNavigationBridge.ts', () => ({
    default: bridge,
}))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents: (callback: typeof listener) => {
        listener = callback
        return unsubscribe
    },
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { success, error: errorToast } }))
const { default: useMaintenance } =
    await import('@/features/Maintenance/Hooks/useMaintenanceLogic.ts')
function maintenanceStatus(
    isMaintenanceActive: boolean,
): MaintenancePageStatus {
    return {
        user: {
            id: 'user-1',
            username: 'Synthetic user',
            email: 'synthetic@example.invalid',
        },
        isMaintenanceActive,
        isMaintenanceScheduled: false,
        maintenanceStartsAt: null,
        canBypassMaintenance: false,
        redirectTo: '/user/catalog',
        canRequestExtension: true,
        pendingExtensionRequest: null,
    }
}
beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    client.clear()
    status = undefined
    searchRedirect = undefined
    storedPath = null
    listener = undefined
})

it.each(['search', 'stored', 'status', 'fallback'] as const)(
    'returns from inactive maintenance using the %s return target',
    (source) => {
        status = maintenanceStatus(false)
        if (source === 'search') searchRedirect = '/admin/users'
        if (source === 'stored' || source === 'search')
            storedPath = '/admin/backups'
        if (source === 'fallback') status.redirectTo = ''
        const result = renderHook(useMaintenance)
        expect(result.state.status?.isMaintenanceActive).toBe(false)
        const cleanup = runEffects()
        expect(navigate).toHaveBeenCalledWith({
            href:
                source === 'search'
                    ? '/admin/users'
                    : source === 'stored'
                      ? '/admin/backups'
                      : source === 'status'
                        ? '/user/catalog'
                        : '/login',
        })
        expect(clearReturn).toHaveBeenCalledTimes(1)
        expect(bridge).toHaveBeenCalledWith(
            expect.objectContaining({
                preRestoreUserId: 'user-1',
                isPreRestoreIdentityResolved: true,
            }),
        )
        cleanup()
        expect(unsubscribe).toHaveBeenCalledTimes(1)
    },
)

it('stays on active maintenance, merges realtime status and navigates after maintenance ends', async () => {
    status = maintenanceStatus(true)
    renderHook(useMaintenance)
    const cleanup = runEffects()
    expect(navigate).not.toHaveBeenCalled()
    await listener?.({
        type: 'maintenance-mode.changed',
        payload: {
            isMaintenanceModeEnabled: true,
            isMaintenanceModeActive: true,
            isMaintenanceModeScheduled: false,
            maintenanceStartsAt: null,
            updatedAt: '2026-11-05T00:00:00Z',
        },
    })
    expect(client.getQueryData(['maintenance-page-status'])).toMatchObject({
        user: null,
        isMaintenanceActive: true,
        redirectTo: '/login',
    })
    await listener?.({
        type: 'maintenance-mode.changed',
        payload: {
            isMaintenanceModeEnabled: false,
            isMaintenanceModeActive: false,
            isMaintenanceModeScheduled: false,
            maintenanceStartsAt: null,
            updatedAt: '2026-11-05T00:00:01Z',
        },
    })
    expect(navigate).toHaveBeenCalledWith({ href: '/user/catalog' })
    expect(client.getQueryData(['maintenance-page-status'])).toMatchObject({
        isMaintenanceActive: false,
    })
    cleanup()
})

it.each(['approved', 'rejected'] as const)(
    'shows only the current user an extension %s result',
    async (resolution) => {
        status = maintenanceStatus(true)
        renderHook(useMaintenance)
        const cleanup = runEffects()
        const event = {
            type: 'maintenance-extension.resolved',
            payload: {
                requestId: 'request-1',
                userId: 'other-user',
                status: resolution,
                maintenanceStartsAt: null,
                resolvedAt: '2026-11-05T00:00:00Z',
            },
        } satisfies RealtimeEvent
        await listener?.(event)
        expect(success).not.toHaveBeenCalled()
        expect(errorToast).not.toHaveBeenCalled()
        await listener?.({
            ...event,
            payload: { ...event.payload, userId: 'user-1' },
        })
        expect(
            resolution === 'approved' ? success : errorToast,
        ).toHaveBeenCalledWith(
            resolution === 'approved'
                ? 'maintenance.extensionApproved'
                : 'maintenance.extensionRejected',
            expect.any(Object),
        )
        cleanup()
    },
)
