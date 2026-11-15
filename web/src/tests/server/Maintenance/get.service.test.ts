import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    createReadDb,
    operators,
    table,
} from '../Admin/AuditLogs/read-query.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

const read = createReadDb()
const session = vi.fn()
const permissions = vi.fn()
const pending = vi.fn()
vi.mock('@/db', () => ({ db: read.db }))
vi.mock('drizzle-orm', () => operators)
vi.mock('@/db/schema.ts', () => ({ systemSettings: table('settings', ['id']) }))
vi.mock('@/server/Auth/currentSession.ts', () => ({
    getActiveCurrentSessionUser: session,
}))
vi.mock('@/lib/Permissions/userPermissions.ts', () => ({
    getUserPermissionKeys: permissions,
}))
vi.mock('@/server/Maintenance/requestStore.ts', () => ({
    getPendingMaintenanceExtensionRequest: pending,
}))
vi.mock('@/server/Realtime/publish.service.ts', () => ({
    publishMaintenanceModeChangedService: vi.fn(),
}))
const { getMaintenancePageStatusService } =
    await import('@/server/Maintenance/get.service.ts')

const user = {
    id: 'member',
    username: 'Ada',
    email: 'ada@example.invalid',
    passwordHash: 'synthetic-not-returned',
}
const requestedAt = new Date('2026-01-01T12:00:00Z')
const request = {
    id: 'request',
    userId: user.id,
    username: user.username,
    reason: 'Need time',
    requestedAt,
}

beforeEach(() => {
    vi.clearAllMocks()
    session.mockReset().mockResolvedValue(user)
    permissions.mockReset().mockResolvedValue([PERMISSIONS.USER_DASHBOARD])
    pending.mockReset().mockResolvedValue(null)
    read.results.length = 0
    read.queries.length = 0
})

describe('maintenance page status', () => {
    it('allows signed-in ordinary users to request an extension for scheduled maintenance', async () => {
        const startsAt = new Date(Date.now() + 86_400_000)
        read.results.push([
            { isMaintenanceModeEnabled: true, maintenanceStartsAt: startsAt },
        ])
        const result = await getMaintenancePageStatusService()
        expect(result.user).toEqual({
            id: user.id,
            username: user.username,
            email: user.email,
        })
        expect(result.isMaintenanceScheduled).toBe(true)
        expect(result.isMaintenanceActive).toBe(false)
        expect(result.maintenanceStartsAt).toBe(startsAt.toISOString())
        expect(result.canRequestExtension).toBe(true)
        expect(result.canBypassMaintenance).toBe(false)
        expect(result.redirectTo).not.toBe('/login')
        expect(permissions).toHaveBeenCalledWith(user.id)
    })

    it('exposes only the current users pending request and blocks another queued request', async () => {
        const settings = {
            isMaintenanceModeEnabled: true,
            maintenanceStartsAt: new Date(Date.now() + 86_400_000),
        }
        read.results.push([settings], [settings])
        pending.mockResolvedValue(request)
        let result = await getMaintenancePageStatusService()
        expect(result.pendingExtensionRequest).toMatchObject({
            id: 'request',
            requestedAt: requestedAt.toISOString(),
            user: { id: user.id, username: user.username },
        })
        expect(result.canRequestExtension).toBe(false)
        pending.mockResolvedValue({
            ...request,
            userId: 'someone-else',
            username: 'Other',
        })
        result = await getMaintenancePageStatusService()
        expect(result.pendingExtensionRequest).toBeNull()
        expect(result.canRequestExtension).toBe(false)
    })

    it('does not grant anonymous sessions bypass or request privileges or reveal another users request', async () => {
        session.mockResolvedValue(null)
        pending.mockResolvedValue(request)
        read.results.push([
            {
                isMaintenanceModeEnabled: true,
                maintenanceStartsAt: new Date(Date.now() + 86_400_000),
            },
        ])
        const result = await getMaintenancePageStatusService()
        expect(result.user).toBeNull()
        expect(result.redirectTo).toBe('/login')
        expect(result.canRequestExtension).toBe(false)
        expect(result.canBypassMaintenance).toBe(false)
        expect(result.pendingExtensionRequest).toBeNull()
        expect(permissions).not.toHaveBeenCalled()
    })

    it('allows explicitly privileged users to bypass maintenance without requesting an extension', async () => {
        permissions.mockResolvedValue([PERMISSIONS.ADMIN_MAINTENANCE_BYPASS])
        read.results.push([
            {
                isMaintenanceModeEnabled: true,
                maintenanceStartsAt: new Date(Date.now() + 86_400_000),
            },
        ])
        const result = await getMaintenancePageStatusService()
        expect(result.canBypassMaintenance).toBe(true)
        expect(result.canRequestExtension).toBe(false)
    })

    it('marks already-started maintenance active and prevents extension requests', async () => {
        read.results.push([
            {
                isMaintenanceModeEnabled: true,
                maintenanceStartsAt: new Date(Date.now() - 86_400_000),
            },
        ])
        const result = await getMaintenancePageStatusService()
        expect(result.isMaintenanceActive).toBe(true)
        expect(result.isMaintenanceScheduled).toBe(false)
        expect(result.canRequestExtension).toBe(false)
    })

    it.each(['absent', 'disabled', 'missing-start'])(
        'treats %s maintenance settings as inactive',
        async (scenario) => {
            read.results.push(
                scenario === 'absent'
                    ? []
                    : [
                          {
                              isMaintenanceModeEnabled: scenario !== 'disabled',
                              maintenanceStartsAt:
                                  scenario === 'missing-start'
                                      ? null
                                      : new Date(),
                          },
                      ],
            )
            const result = await getMaintenancePageStatusService()
            expect(result.isMaintenanceActive).toBe(false)
            expect(result.isMaintenanceScheduled).toBe(false)
            expect(result.maintenanceStartsAt).toBeNull()
            expect(result.canRequestExtension).toBe(false)
        },
    )
})
