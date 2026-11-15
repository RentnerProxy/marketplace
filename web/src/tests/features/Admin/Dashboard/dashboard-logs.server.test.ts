import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'

const events: Array<string> = []
const permission = vi.fn(async function (_permission: string) {
    events.push('permission')
    return { userId: 'admin-user' }
})
const rateLimit = vi.fn(async function (_options: unknown) {
    events.push('rate-limit')
})
const logs = vi.fn(async function (_service: string) {
    events.push('logs')
    return { entries: [], sharedHistoryAvailable: true }
})
const readerOrigin = vi.fn((): string | null => null)
vi.mock('@/server/Logging/container-log-client.service.ts', () => ({
    getContainerLogReaderOriginService: readerOrigin,
}))
vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => ({
        handler: (run: () => Promise<unknown>) => run,
        validator: (validate: (data: unknown) => unknown) => ({
            handler:
                (run: (input: { data: unknown }) => Promise<unknown>) =>
                async (options: { data: unknown }) =>
                    run({ data: validate(options.data) }),
        }),
    }),
}))
vi.mock('@/server/Auth/authorization.service.ts', () => ({
    requirePermissionService: permission,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: rateLimit,
    RateLimitError: class extends Error {},
}))
vi.mock('@/server/Admin/Dashboard/dashboard-logs.service.ts', () => ({
    getDashboardLogsService: logs,
}))
vi.mock('@/server/Admin/Dashboard/dashboard-health.service.ts', () => ({
    getDashboardHealthService: vi.fn(),
    getDashboardRateLimitUnavailableHealthService: vi.fn(),
}))

const { getDashboardLogsHandler } =
    await import('@/features/Admin/Dashboard/middleware.ts')

beforeEach(function () {
    vi.clearAllMocks()
    events.length = 0
    readerOrigin.mockReturnValue(null)
})

describe('Geschützter Konsolenzugriff', function () {
    it('öffnet die WebSocket-Konsole über die bestehende Autorisierung und das Rate-Limit', async () => {
        await getDashboardLogsHandler({ data: { service: 'websocket' } })
        expect(events).toEqual(['permission', 'rate-limit', 'logs'])
        expect(logs).toHaveBeenCalledWith('websocket')
    })
    it('fordert für die Rust-Konsole auch in der Entwicklung Superuser-Rechte an', async function () {
        await getDashboardLogsHandler({ data: { service: 'core' } })
        expect(permission.mock.calls.map((call) => call[0])).toEqual([
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.ADMIN_SUPER_USER,
        ])
        expect(logs).toHaveBeenCalledWith('core')
    })

    it('verweigert die Rust-Konsole vor Rate-Limit und Logzugriff ohne Superuser-Rechte', async function () {
        permission.mockResolvedValueOnce({ userId: 'admin-user' })
        permission.mockRejectedValueOnce(new Error('permission_denied'))
        await expect(
            getDashboardLogsHandler({ data: { service: 'core' } }),
        ).rejects.toThrow('permission_denied')
        expect(rateLimit).not.toHaveBeenCalled()
        expect(logs).not.toHaveBeenCalled()
    })
    it('prüft Berechtigung und kontoweites Rate-Limit vor dem Lesen des gewählten Dienstes', async function () {
        await getDashboardLogsHandler({ data: { service: 'worker' } })
        expect(events).toEqual(['permission', 'rate-limit', 'logs'])
        expect(permission).toHaveBeenCalledWith(PERMISSIONS.ADMIN_DASHBOARD)
        expect(rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.adminDashboardLogsRead,
            scope: 'admin-dashboard-logs-read',
            identifiers: ['admin-user'],
            includeClientIp: false,
        })
        expect(logs).toHaveBeenCalledWith('worker')
    })

    it.each(['authentication_required', 'permission_denied', 'maintenance'])(
        'liest bei verweigertem Zugriff keine Logs (%s)',
        async function (reason) {
            permission.mockRejectedValueOnce(new Error(reason))
            await expect(
                getDashboardLogsHandler({ data: { service: 'webserver' } }),
            ).rejects.toThrow(reason)
            expect(rateLimit).not.toHaveBeenCalled()
            expect(logs).not.toHaveBeenCalled()
        },
    )

    it('liest ohne bestätigtes Rate-Limit keinen gemeinsamen oder lokalen Verlauf', async function () {
        rateLimit.mockRejectedValueOnce(new Error('rate-limit-unavailable'))
        await expect(
            getDashboardLogsHandler({ data: { service: 'valkey' } }),
        ).rejects.toThrow('rate-limit-unavailable')
        expect(logs).not.toHaveBeenCalled()
    })

    it('verwirft unbekannte Dienste und zusätzliche Eingaben vor dem Zugriff', async function () {
        await expect(
            getDashboardLogsHandler({
                data: { service: '../../private' },
            }),
        ).rejects.toThrow()
        await expect(
            getDashboardLogsHandler({
                data: { service: 'webserver', command: 'whoami' },
            }),
        ).rejects.toThrow()
        expect(permission).not.toHaveBeenCalled()
        expect(logs).not.toHaveBeenCalled()
    })

    it('fordert für echte Containerlogs zusätzlich Superuser-Rechte an', async function () {
        readerOrigin.mockReturnValue('http://log-reader:3004')
        await getDashboardLogsHandler({ data: { service: 'webserver' } })
        expect(permission.mock.calls.map((call) => call[0])).toEqual([
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.ADMIN_SUPER_USER,
        ])
        expect(events).toEqual([
            'permission',
            'permission',
            'rate-limit',
            'logs',
        ])
    })

    it('gibt Containerlogs ohne Superuser-Rechte nicht frei', async function () {
        readerOrigin.mockReturnValue('http://log-reader:3004')
        permission.mockResolvedValueOnce({ userId: 'admin-user' })
        permission.mockRejectedValueOnce(new Error('permission_denied'))
        await expect(
            getDashboardLogsHandler({ data: { service: 'postgresql' } }),
        ).rejects.toThrow('permission_denied')
        expect(rateLimit).not.toHaveBeenCalled()
        expect(logs).not.toHaveBeenCalled()
    })
})
