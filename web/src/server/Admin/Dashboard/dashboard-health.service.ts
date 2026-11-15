import { DASHBOARD_HEALTH } from '@/config/health.config.ts'
import { db } from '@/db/index.ts'
import type {
    DashboardHealthSnapshot,
    DashboardServiceHealth,
    DashboardServiceId,
} from '@/features/Admin/Dashboard/Types/dashboard-domain.types.ts'
import { logWarn } from '@/server/Logging/logger.ts'
import { recordRuntimeLogService } from '@/server/Logging/runtime-log-history.service.ts'
import { getWorkerRuntimeHealthService } from '@/server/Runtime/worker-status.service.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import { getCoreRuntimeHealthService } from '@/server/Core/health.service.ts'
import { probeRealtimeHealthService } from '@/server/Runtime/realtime-health.service.ts'

class HealthcheckTimeoutError extends Error {}

const lastHealthLogs = new Map<
    DashboardServiceId,
    { health: DashboardServiceHealth; timestamp: number }
>()

async function waitForHealthcheckService<T>(
    operation: Promise<T>,
    onTimeout?: () => void,
): Promise<T> {
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            operation,
            new Promise<never>(function (_resolve, reject) {
                deadline = setTimeout(function () {
                    reject(new HealthcheckTimeoutError())
                    try {
                        onTimeout?.()
                    } catch {}
                }, DASHBOARD_HEALTH.checkTimeoutMs)
            }),
        ])
    } finally {
        if (deadline !== undefined) clearTimeout(deadline)
    }
}

async function checkServiceHealthService(
    service: DashboardServiceId,
    check: () => Promise<DashboardServiceHealth>,
): Promise<DashboardServiceHealth> {
    try {
        return await check()
    } catch (error) {
        logWarn('admin.dashboard.health_check_failed', { service })
        if (service === 'worker') {
            return { status: 'unknown', detail: 'workerStatusUnavailable' }
        }
        return {
            status: 'error',
            detail:
                error instanceof HealthcheckTimeoutError
                    ? 'timeout'
                    : 'checkFailed',
        }
    }
}

async function checkPostgresqlHealthService(): Promise<DashboardServiceHealth> {
    const query = db.$client.unsafe<unknown>('SELECT 1')
    await waitForHealthcheckService(Promise.resolve(query), function () {
        void query.cancel().catch(() => undefined)
    })
    return { status: 'running', detail: 'connectionAvailable' }
}

async function checkValkeyHealthService(): Promise<DashboardServiceHealth> {
    const valkey = getValkeyConnection()
    try {
        const response = await waitForHealthcheckService(valkey.ping())
        if (response !== 'PONG')
            return { status: 'error', detail: 'checkFailed' }
        return { status: 'running', detail: 'connectionAvailable' }
    } catch (error) {
        if (['wait', 'connecting', 'connect'].includes(valkey.status)) {
            return { status: 'connecting', detail: 'connectionPending' }
        }
        if (['end', 'close', 'reconnecting'].includes(valkey.status)) {
            return { status: 'down', detail: 'connectionClosed' }
        }
        throw error
    }
}

async function checkWorkerHealthService(): Promise<DashboardServiceHealth> {
    const health = await waitForHealthcheckService(
        getWorkerRuntimeHealthService(),
    )
    if (health.reason === 'missing') {
        return { status: 'down', detail: 'heartbeatMissing' }
    }
    if (health.reason === 'expired') {
        return { status: 'down', detail: 'heartbeatExpired' }
    }
    if (health.reason === 'invalid') {
        return { status: 'error', detail: 'heartbeatInvalid' }
    }
    if (health.status === 'starting') {
        return { status: 'starting', detail: 'workerStarting' }
    }
    if (health.status === 'error') {
        return { status: 'error', detail: 'workerUnhealthy' }
    }
    return { status: 'running', detail: 'heartbeatCurrent' }
}

async function checkCoreHealthService(): Promise<DashboardServiceHealth> {
    const runtime = await getCoreRuntimeHealthService()
    return { status: 'running', detail: 'coreResponding', runtime }
}

async function checkWebsocketHealthService(): Promise<DashboardServiceHealth> {
    const controller = new AbortController()
    const responding = await waitForHealthcheckService(
        probeRealtimeHealthService(controller.signal),
        () => controller.abort(),
    )
    return responding
        ? { status: 'running', detail: 'websocketResponding' }
        : { status: 'down', detail: 'websocketUnavailable' }
}

export function getDashboardRateLimitUnavailableHealthService(): DashboardHealthSnapshot {
    logWarn('admin.dashboard.rate_limit_unavailable')
    // Webserver und Datenbank haben den authentifizierten Zugriff bereits beantwortet.
    return {
        services: {
            webserver: { status: 'running', detail: 'responding' },
            websocket: { status: 'unknown', detail: 'statusUnavailable' },
            postgresql: { status: 'running', detail: 'connectionAvailable' },
            valkey: { status: 'error', detail: 'rateLimitUnavailable' },
            worker: { status: 'unknown', detail: 'workerStatusUnavailable' },
            core: { status: 'unknown', detail: 'statusUnavailable' },
        },
    }
}

export async function getDashboardHealthService(): Promise<DashboardHealthSnapshot> {
    const [postgresql, valkey, worker, core, websocket] = await Promise.all([
        checkServiceHealthService('postgresql', checkPostgresqlHealthService),
        checkServiceHealthService('valkey', checkValkeyHealthService),
        checkServiceHealthService('worker', checkWorkerHealthService),
        checkServiceHealthService('core', checkCoreHealthService),
        checkServiceHealthService('websocket', checkWebsocketHealthService),
    ])

    const snapshot: DashboardHealthSnapshot = {
        services: {
            webserver: { status: 'running', detail: 'responding' },
            websocket,
            worker,
            postgresql,
            valkey,
            core,
        },
    }
    for (const service of [
        'webserver',
        'websocket',
        'worker',
        'postgresql',
        'valkey',
        'core',
    ] as const) {
        const health = snapshot.services[service]
        const previous = lastHealthLogs.get(service)
        const timestamp = Date.now()
        if (
            previous?.health.status === health.status &&
            previous.health.detail === health.detail &&
            timestamp >= previous.timestamp &&
            timestamp - previous.timestamp < DASHBOARD_HEALTH.logIntervalMs
        )
            continue
        lastHealthLogs.set(service, { health, timestamp })
        recordRuntimeLogService(
            {
                level:
                    health.status === 'running'
                        ? 'info'
                        : health.status === 'error' || health.status === 'down'
                          ? 'error'
                          : 'warn',
                event: `health.${health.detail}`.replace(
                    /[A-Z]/g,
                    (letter) => `_${letter.toLowerCase()}`,
                ),
                context: {},
            },
            service,
        )
    }
    return snapshot
}
