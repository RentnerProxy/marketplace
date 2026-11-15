import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import { requireMaintenanceAccessService } from '@/server/Maintenance/access.service.ts'

const getMaintenanceState = vi.fn()
vi.mock('@/server/Maintenance/state.service.ts', () => ({
    getMaintenanceStateService: getMaintenanceState,
}))

describe('Maintenance access for authenticated features', function () {
    beforeEach(function () {
        getMaintenanceState.mockReset().mockResolvedValue({
            isActive: false,
            isScheduled: false,
            startsAt: null,
        })
    })

    it.each([
        { isActive: false, isScheduled: false, startsAt: null },
        {
            isActive: false,
            isScheduled: true,
            startsAt: '2026-10-01T00:00:00.000Z',
        },
    ])(
        'allows normal access before maintenance is active',
        async function (state) {
            getMaintenanceState.mockResolvedValue(state)
            await expect(
                requireMaintenanceAccessService([]),
            ).resolves.toBeUndefined()
            expect(getMaintenanceState).toHaveBeenCalledTimes(1)
        },
    )

    it.each([
        [],
        [PERMISSIONS.USER_DASHBOARD],
        [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
        [PERMISSIONS.ADMIN_SUPER_USER],
        ['admin.maintenanceBypass.extra'],
    ])(
        'rejects active maintenance without the exact bypass permission',
        async function (...keys) {
            getMaintenanceState.mockResolvedValue({
                isActive: true,
                isScheduled: false,
                startsAt: '2026-09-01T00:00:00.000Z',
            })
            await expect(
                requireMaintenanceAccessService(keys),
            ).rejects.toBeInstanceOf(MaintenanceModeError)
        },
    )

    it('allows explicit bypass independently of maintenance availability', async function () {
        getMaintenanceState.mockRejectedValue(new Error('unavailable'))
        await expect(
            requireMaintenanceAccessService([
                PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
            ]),
        ).resolves.toBeUndefined()
        expect(getMaintenanceState).not.toHaveBeenCalled()
    })

    it('does not silently allow ordinary access when the state cannot be loaded', async function () {
        const failure = new Error('state unavailable')
        getMaintenanceState.mockRejectedValue(failure)
        await expect(requireMaintenanceAccessService([])).rejects.toBe(failure)
    })

    it('reads the state again for each call rather than caching a previous allow', async function () {
        await requireMaintenanceAccessService([])
        getMaintenanceState.mockResolvedValue({ isActive: true })
        await expect(
            requireMaintenanceAccessService([]),
        ).rejects.toBeInstanceOf(MaintenanceModeError)
        expect(getMaintenanceState).toHaveBeenCalledTimes(2)
    })

    it('exposes only a stable code and a temporary-unavailable status', function () {
        const error = new MaintenanceModeError()
        expect(error.code).toBe('MAINTENANCE_ACTIVE')
        expect(error.status).toBe(503)
        expect(error.name).toBe('MaintenanceModeError')
    })
})
