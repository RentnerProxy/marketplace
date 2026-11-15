import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    setSystemTime,
    vi,
} from 'bun:test'
import { DASHBOARD_HEALTH } from '@/config/health.config.ts'
import type { DashboardServiceHealth } from '@/features/Admin/Dashboard/Types/dashboard-domain.types.ts'
import type { WorkerRuntimeHealth } from '@/server/Runtime/Types/worker-status.types.ts'

const cancel = vi.fn(async () => [])
const query = vi.fn((_statement: string) =>
    Object.assign(Promise.resolve<unknown>([{ '?column?': 1 }]), { cancel }),
)
const ping = vi.fn(async () => 'PONG')
const worker = vi.fn(async (): Promise<WorkerRuntimeHealth> => ({
    status: 'running',
    reason: 'heartbeat',
}))
const warn = vi.fn()
const recordLog = vi.fn()
vi.mock('@/server/Logging/runtime-log-history.service.ts', () => ({
    recordRuntimeLogService: recordLog,
}))
const websocket = vi.fn(async (_signal: AbortSignal) => true)
vi.mock('@/server/Runtime/realtime-health.service.ts', () => ({
    probeRealtimeHealthService: websocket,
}))
const valkey = { status: 'ready', ping }
const core = vi.fn(async () => ({
    status: 'running' as const,
    version: '0.1.0',
    pid: 123,
    uptimeSeconds: 10,
}))
vi.mock('@/server/Core/health.service.ts', () => ({
    getCoreRuntimeHealthService: core,
}))

vi.mock('@/db/index.ts', () => ({ db: { $client: { unsafe: query } } }))
vi.mock('@/server/Valkey/valkey.service.ts', () => ({
    getValkeyConnection: () => valkey,
}))
vi.mock('@/server/Runtime/worker-status.service.ts', () => ({
    getWorkerRuntimeHealthService: worker,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logWarn: warn }))

const {
    getDashboardHealthService,
    getDashboardRateLimitUnavailableHealthService,
} = await import('@/server/Admin/Dashboard/dashboard-health.service.ts')

let clock = Date.now()

beforeEach(function () {
    vi.clearAllMocks()
    clock += DASHBOARD_HEALTH.logIntervalMs * 2
    setSystemTime(new Date(clock))
    valkey.status = 'ready'
    query.mockImplementation(() =>
        Object.assign(Promise.resolve<unknown>([{ '?column?': 1 }]), {
            cancel,
        }),
    )
    ping.mockResolvedValue('PONG')
    websocket.mockResolvedValue(true)
    worker.mockResolvedValue({ status: 'running', reason: 'heartbeat' })
    core.mockResolvedValue({
        status: 'running',
        version: '0.1.0',
        pid: 123,
        uptimeSeconds: 10,
    })
})
afterEach(function () {
    vi.useRealTimers()
    setSystemTime()
})

describe('Statusprüfungen im Admin-Dashboard', function () {
    it('zeigt nach erfolgreicher Autorisierung und ausgefallenem Rate-Limit nur belegte Dienste ohne weitere Zugriffe', function () {
        const snapshot = getDashboardRateLimitUnavailableHealthService()
        expect(snapshot.services).toEqual({
            webserver: { status: 'running', detail: 'responding' },
            websocket: { status: 'unknown', detail: 'statusUnavailable' },
            postgresql: { status: 'running', detail: 'connectionAvailable' },
            valkey: { status: 'error', detail: 'rateLimitUnavailable' },
            worker: { status: 'unknown', detail: 'workerStatusUnavailable' },
            core: { status: 'unknown', detail: 'statusUnavailable' },
        })
        expect(query).not.toHaveBeenCalled()
        expect(ping).not.toHaveBeenCalled()
        expect(worker).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith(
            'admin.dashboard.rate_limit_unavailable',
        )
        expect(recordLog).not.toHaveBeenCalled()
    })

    it('protokolliert bestätigte Statusmeldungen sofort und bei unverändertem Zustand einmal pro Minute', async function () {
        await getDashboardHealthService()
        expect(recordLog).toHaveBeenCalledTimes(6)
        expect(recordLog).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'info',
                event: 'health.connection_available',
            }),
            'postgresql',
        )
        recordLog.mockClear()

        setSystemTime(new Date(clock + DASHBOARD_HEALTH.logIntervalMs - 1))
        await getDashboardHealthService()
        expect(recordLog).not.toHaveBeenCalled()

        setSystemTime(new Date(clock + DASHBOARD_HEALTH.logIntervalMs))
        await getDashboardHealthService()
        expect(recordLog).toHaveBeenCalledTimes(6)
    })

    it('protokolliert Ausfälle und Erholung sofort mit dem tatsächlich geprüften Zustand', async function () {
        await getDashboardHealthService()
        recordLog.mockClear()

        websocket.mockResolvedValueOnce(false)
        await getDashboardHealthService()
        expect(recordLog).toHaveBeenCalledTimes(1)
        expect(recordLog).toHaveBeenLastCalledWith(
            expect.objectContaining({
                level: 'error',
                event: 'health.websocket_unavailable',
            }),
            'websocket',
        )

        await getDashboardHealthService()
        expect(recordLog).toHaveBeenCalledTimes(2)
        expect(recordLog).toHaveBeenLastCalledWith(
            expect.objectContaining({
                level: 'info',
                event: 'health.websocket_responding',
            }),
            'websocket',
        )
    })

    it('prüft die sechs Dienste einschließlich WebSocket und des tatsächlichen Rust-Prozesses', async function () {
        const snapshot = await getDashboardHealthService()
        expect(snapshot.services).toEqual({
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
        })
        expect(query).toHaveBeenCalledWith('SELECT 1')
        expect(ping).toHaveBeenCalledTimes(1)
        expect(worker).toHaveBeenCalledTimes(1)
        expect(websocket).toHaveBeenCalledTimes(1)
    })

    it('zeigt einen nicht antwortenden WebSocket-Endpunkt unabhängig vom gesunden Webserver', async () => {
        websocket.mockResolvedValueOnce(false)
        const snapshot = await getDashboardHealthService()
        expect(snapshot.services.websocket).toEqual({
            status: 'down',
            detail: 'websocketUnavailable',
        })
        expect(snapshot.services.webserver.status).toBe('running')
    })

    it('bricht eine hängende WebSocket-Prüfung am Zeitlimit ab', async () => {
        vi.useFakeTimers()
        websocket.mockImplementationOnce(
            async () => new Promise<boolean>(() => {}),
        )
        const pending = getDashboardHealthService()
        vi.advanceTimersByTime(DASHBOARD_HEALTH.checkTimeoutMs + 1)
        const snapshot = await pending
        expect(snapshot.services.websocket).toEqual({
            status: 'error',
            detail: 'timeout',
        })
        expect(websocket.mock.calls[0]?.[0].aborted).toBe(true)
    })

    it('isoliert PostgreSQL-Fehler und gibt keine internen Ursachen aus', async function () {
        query.mockImplementationOnce(() =>
            Object.assign(
                Promise.reject(new Error('private-database-password')),
                { cancel },
            ),
        )
        const snapshot = await getDashboardHealthService()
        expect(snapshot.services.postgresql).toEqual({
            status: 'error',
            detail: 'checkFailed',
        })
        expect(snapshot.services.worker.status).toBe('running')
        expect(snapshot.services.valkey.status).toBe('running')
        expect(JSON.stringify(snapshot)).not.toContain(
            'private-database-password',
        )
        expect(warn).toHaveBeenCalledWith(
            'admin.dashboard.health_check_failed',
            { service: 'postgresql' },
        )
    })

    it.each(['wait', 'connecting', 'connect'])(
        'zeigt einen Verbindungsaufbau von Valkey gelb (%s)',
        async function (status) {
            valkey.status = status
            ping.mockRejectedValueOnce(new Error('connecting'))
            expect((await getDashboardHealthService()).services.valkey).toEqual(
                { status: 'connecting', detail: 'connectionPending' },
            )
        },
    )

    it.each(['close', 'end', 'reconnecting'])(
        'zeigt einen unterbrochenen Valkey-Dienst als down (%s)',
        async function (status) {
            valkey.status = status
            ping.mockRejectedValueOnce(new Error('disconnected'))
            expect((await getDashboardHealthService()).services.valkey).toEqual(
                { status: 'down', detail: 'connectionClosed' },
            )
        },
    )

    it('fordert eine echte PONG-Antwort an und übernimmt keine Fehlerantwort', async function () {
        ping.mockResolvedValueOnce('NOT READY')
        expect((await getDashboardHealthService()).services.valkey).toEqual({
            status: 'error',
            detail: 'checkFailed',
        })
    })

    it('trennt bei Valkey-Ausfall die fehlende Worker-Auskunft von den erreichbaren Diensten', async function () {
        valkey.status = 'close'
        ping.mockRejectedValueOnce(new Error('private-valkey-password'))
        worker.mockRejectedValueOnce(new Error('private-valkey-password'))
        const snapshot = await getDashboardHealthService()
        expect(snapshot.services.webserver.status).toBe('running')
        expect(snapshot.services.postgresql.status).toBe('running')
        expect(snapshot.services.valkey).toEqual({
            status: 'down',
            detail: 'connectionClosed',
        })
        expect(snapshot.services.worker).toEqual({
            status: 'unknown',
            detail: 'workerStatusUnavailable',
        })
        expect(JSON.stringify(snapshot)).not.toContain(
            'private-valkey-password',
        )
        expect(warn).toHaveBeenCalledWith(
            'admin.dashboard.health_check_failed',
            { service: 'worker' },
        )
    })

    it.each([
        {
            health: { status: 'starting', reason: 'heartbeat' },
            expected: { status: 'starting', detail: 'workerStarting' },
        },
        {
            health: { status: 'error', reason: 'heartbeat' },
            expected: { status: 'error', detail: 'workerUnhealthy' },
        },
        {
            health: { status: 'down', reason: 'missing' },
            expected: { status: 'down', detail: 'heartbeatMissing' },
        },
        {
            health: { status: 'down', reason: 'expired' },
            expected: { status: 'down', detail: 'heartbeatExpired' },
        },
        {
            health: { status: 'error', reason: 'invalid' },
            expected: { status: 'error', detail: 'heartbeatInvalid' },
        },
    ] satisfies Array<{
        health: WorkerRuntimeHealth
        expected: DashboardServiceHealth
    }>)(
        'zeigt den tatsächlichen Worker-Zustand ($health.reason/$health.status)',
        async function ({ health, expected }) {
            worker.mockResolvedValueOnce(health)
            expect((await getDashboardHealthService()).services.worker).toEqual(
                expected,
            )
        },
    )

    it('prüft parallel, beendet hängende Prüfungen und bricht die SQL-Abfrage ab', async function () {
        vi.useFakeTimers()
        query.mockImplementationOnce(() =>
            Object.assign(new Promise<unknown>(() => {}), { cancel }),
        )
        worker.mockImplementationOnce(() => new Promise(() => {}))
        const pending = getDashboardHealthService()
        expect(query).toHaveBeenCalledTimes(1)
        expect(ping).toHaveBeenCalledTimes(1)
        expect(worker).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(DASHBOARD_HEALTH.checkTimeoutMs)
        const snapshot = await pending
        expect(snapshot.services.postgresql).toEqual({
            status: 'error',
            detail: 'timeout',
        })
        expect(snapshot.services.worker).toEqual({
            status: 'unknown',
            detail: 'workerStatusUnavailable',
        })
        expect(snapshot.services.valkey.status).toBe('running')
        expect(cancel).toHaveBeenCalledTimes(1)
    })
})
