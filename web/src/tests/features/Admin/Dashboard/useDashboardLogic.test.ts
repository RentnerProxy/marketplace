import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import {
    query as useQuery,
    render,
    reset,
} from '../UserManagement/user-management-hooks.test.helpers.ts'
import type { UseQueryOptions } from '@tanstack/react-query'
import { DASHBOARD_HEALTH } from '@/config/health.config.ts'
import type { DashboardHealthSnapshot } from '@/features/Admin/Dashboard/Types/dashboard-domain.types.ts'

const healthySnapshot: DashboardHealthSnapshot = {
    services: {
        webserver: { status: 'running', detail: 'responding' },
        websocket: { status: 'running', detail: 'websocketResponding' },
        worker: { status: 'running', detail: 'heartbeatCurrent' },
        postgresql: { status: 'running', detail: 'connectionAvailable' },
        valkey: { status: 'running', detail: 'connectionAvailable' },
        core: {
            status: 'running',
            detail: 'coreResponding',
            runtime: {
                status: 'running',
                version: '0.1.0',
                pid: 123,
                uptimeSeconds: 10,
            },
        },
    },
}
const result = {
    data: undefined as DashboardHealthSnapshot | undefined,
    isError: false,
    fetchStatus: 'fetching' as 'fetching' | 'idle' | 'paused',
}
const getHealth = vi.fn(
    async (_options?: { signal?: AbortSignal }) => healthySnapshot,
)

vi.mock('@/features/Admin/Dashboard/middleware.ts', () => ({
    getDashboardHealthHandler: getHealth,
}))

const { default: useDashboardLogic } =
    await import('@/features/Admin/Dashboard/Hooks/useDashboardLogic.ts')

beforeEach(function () {
    reset()
    useQuery.mockImplementation(() => result)
    result.data = undefined
    result.isError = false
    result.fetchStatus = 'fetching'
})

describe('Aktualität der Dashboard-Statuskarten', function () {
    it('zeigt während der ersten Prüfung keine erfundenen grünen Werte', function () {
        expect(
            Object.values(render(useDashboardLogic).state.services).every(
                (health) => health.status === 'checking',
            ),
        ).toBe(true)
    })

    it('zeigt die bestätigten Statuswerte auch während einer normalen Aktualisierung', function () {
        result.data = healthySnapshot
        expect(render(useDashboardLogic).state.services).toEqual(
            healthySnapshot.services,
        )
    })

    it('verwirft alte grüne Werte nach einer fehlgeschlagenen Aktualisierung', function () {
        result.data = healthySnapshot
        result.isError = true
        expect(
            Object.values(render(useDashboardLogic).state.services).every(
                (health) => health.status === 'unknown',
            ),
        ).toBe(true)
    })

    it('zeigt bei pausierten Offline-Anfragen keine alten Statuswerte', function () {
        result.data = healthySnapshot
        result.fetchStatus = 'paused'
        expect(
            Object.values(render(useDashboardLogic).state.services).every(
                (health) => health.status === 'unknown',
            ),
        ).toBe(true)
    })

    it('aktualisiert alle zehn Sekunden, stoppt im Hintergrund und reicht Abbrüche weiter', async function () {
        render(useDashboardLogic)
        const options = useQuery.mock.calls[0]?.[0] as
            UseQueryOptions<DashboardHealthSnapshot> | undefined
        expect(options).toMatchObject({
            queryKey: ['admin-dashboard-health'],
            refetchInterval: DASHBOARD_HEALTH.refetchIntervalMs,
            refetchIntervalInBackground: false,
            refetchOnWindowFocus: 'always',
            retry: false,
            gcTime: 0,
        })
        if (typeof options?.queryFn !== 'function')
            throw new Error('Query-Funktion fehlt')
        const controller = new AbortController()
        await options.queryFn({
            queryKey: ['admin-dashboard-health'],
            signal: controller.signal,
            client: new QueryClient(),
            meta: undefined,
        })
        const signal = getHealth.mock.calls[0]?.[0]?.signal
        expect(signal?.aborted).toBe(false)
        controller.abort()
        expect(signal?.aborted).toBe(true)
    })

    it('öffnet eine Konsole, wechselt den Dienst und schließt beim erneuten Anklicken', function () {
        expect(render(useDashboardLogic).state.selectedService).toBeNull()
        render(useDashboardLogic).handler.handleSelectService('webserver')
        expect(render(useDashboardLogic).state.selectedService).toBe(
            'webserver',
        )
        render(useDashboardLogic).handler.handleSelectService('websocket')
        expect(render(useDashboardLogic).state.selectedService).toBe(
            'websocket',
        )
        render(useDashboardLogic).handler.handleSelectService('websocket')
        expect(render(useDashboardLogic).state.selectedService).toBeNull()
    })
})
