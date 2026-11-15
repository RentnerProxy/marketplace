import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'

const events: Array<string> = []
const methods: Array<string> = []
const permission = vi.fn(async function (_permission: string) {
    events.push('permission')
    return { userId: 'admin-user' }
})
const rateLimit = vi.fn(async function (_options: unknown) {
    events.push('rate-limit')
})
const service = vi.fn(async function () {
    events.push('service')
    return { services: {} }
})
const unavailableService = vi.fn(function () {
    events.push('unavailable')
    return { services: {} }
})
const { RateLimitError } =
    await import('@/server/RateLimit/rateLimit.service.ts')

vi.mock('@tanstack/react-start', () => ({
    createServerFn: ({ method }: { method: string }) => {
        methods.push(method)
        return {
            handler: (run: () => Promise<unknown>) => run,
            validator: () => ({
                handler: (run: () => Promise<unknown>) => run,
            }),
        }
    },
}))
vi.mock('@/server/Auth/authorization.service.ts', () => ({
    requirePermissionService: permission,
}))
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: rateLimit,
    RateLimitError,
}))
vi.mock('@/server/Admin/Dashboard/dashboard-health.service.ts', () => ({
    getDashboardHealthService: service,
    getDashboardRateLimitUnavailableHealthService: unavailableService,
}))

const { getDashboardHealthHandler } =
    await import('@/features/Admin/Dashboard/middleware.ts')

beforeEach(function () {
    vi.clearAllMocks()
    events.length = 0
})

describe('Zugriff auf den Admin-Dashboard-Status', function () {
    it('prüft Dashboard-Berechtigung und kontoweites Rate-Limit vor den Diensten', async function () {
        await getDashboardHealthHandler()
        expect(methods).toEqual(['GET', 'GET'])
        expect(permission).toHaveBeenCalledWith(PERMISSIONS.ADMIN_DASHBOARD)
        expect(rateLimit).toHaveBeenCalledWith({
            ...RATE_LIMITS.adminDashboardRead,
            scope: 'admin-dashboard-read',
            identifiers: ['admin-user'],
            includeClientIp: false,
        })
        expect(events).toEqual(['permission', 'rate-limit', 'service'])
    })

    it.each(['authentication_required', 'permission_denied', 'maintenance'])(
        'liest bei verweigertem Zugriff keine Infrastrukturinformationen (%s)',
        async function (reason) {
            permission.mockRejectedValueOnce(new Error(reason))
            await expect(getDashboardHealthHandler()).rejects.toThrow(reason)
            expect(rateLimit).not.toHaveBeenCalled()
            expect(service).not.toHaveBeenCalled()
            expect(unavailableService).not.toHaveBeenCalled()
        },
    )

    it('respektiert ein verweigertes Rate-Limit', async function () {
        const error = new RateLimitError(60)
        rateLimit.mockRejectedValueOnce(error)
        await expect(getDashboardHealthHandler()).rejects.toBe(error)
        expect(service).not.toHaveBeenCalled()
        expect(unavailableService).not.toHaveBeenCalled()
    })

    it('liefert bei ausgefallenem Valkey nur bereits bestätigte Informationen ohne weitere Prüfungen', async function () {
        rateLimit.mockImplementationOnce(async function () {
            events.push('rate-limit')
            throw new Error('private-valkey-password')
        })
        await getDashboardHealthHandler()
        expect(events).toEqual(['permission', 'rate-limit', 'unavailable'])
        expect(unavailableService).toHaveBeenCalledTimes(1)
        expect(service).not.toHaveBeenCalled()
    })
})
