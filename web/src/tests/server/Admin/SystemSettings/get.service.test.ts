import { beforeEach, describe, expect, it, vi } from 'bun:test'

const settings = vi.fn()
const pending = vi.fn()
const maintenance = vi.fn()
vi.mock('@/server/Admin/SystemSettings/settings.service.ts', () => ({
    getOrCreateSystemSettingsService: settings,
}))
vi.mock('@/server/Maintenance/requestStore.ts', () => ({
    getPendingMaintenanceExtensionRequest: pending,
}))
vi.mock('@/server/Maintenance/state.service.ts', () => ({
    deriveMaintenanceState: maintenance,
}))
vi.mock('@/lib/Images/publicImagePaths.ts', () => ({
    getSystemLogoPublicImagePaths: () => ({
        relativeLarge: '/logo.webp',
        relativeSmall: '/logo-64.webp',
        relativeFavicon: '/favicon.ico',
    }),
}))
const { getVersion, getPublicSystemSettingsService, getSystemSettingsService } =
    await import('@/server/Admin/SystemSettings/get.service.ts')

beforeEach(() => {
    vi.clearAllMocks()
    settings.mockReset().mockResolvedValue({
        companyName: 'Company',
        logoUpdatedAt: null,
        isPublicRegistrationEnabled: false,
        isMaintenanceModeEnabled: false,
    })
    pending.mockReset().mockResolvedValue(null)
    maintenance.mockReset().mockReturnValue({
        isActive: false,
        isScheduled: false,
        startsAt: null,
    })
})

describe('system settings read models', () => {
    it('uses fallback images with no pending request data in public settings', async () => {
        pending.mockResolvedValue({
            id: 'private-request',
            userId: 'member',
            username: 'Ada',
            reason: 'Private',
            requestedAt: new Date(),
        })
        expect(await getPublicSystemSettingsService()).toEqual({
            companyName: 'Company',
            logoSrc: '/images/default.webp',
            logoSrc64: '/images/default.webp',
            faviconSrc: '/favicon.ico',
            isPublicRegistrationEnabled: false,
            isMaintenanceModeEnabled: false,
            isMaintenanceModeActive: false,
            isMaintenanceModeScheduled: false,
            maintenanceStartsAt: null,
            pendingMaintenanceExtensionRequest: null,
        })
        expect(pending).not.toHaveBeenCalled()
    })

    it('adds cache-busting image versions and serializes the administrator extension request', async () => {
        const updated = new Date('2026-01-01T12:00:00Z')
        const rawSettings = {
            companyName: 'Company',
            logoUpdatedAt: updated,
            isPublicRegistrationEnabled: true,
            isMaintenanceModeEnabled: true,
        }
        settings.mockResolvedValue(rawSettings)
        maintenance.mockReturnValue({
            isActive: false,
            isScheduled: true,
            startsAt: '2026-12-01T12:00:00Z',
        })
        pending.mockResolvedValue({
            id: 'request',
            userId: 'member',
            username: 'Ada',
            reason: 'Need time',
            requestedAt: updated,
        })
        const result = await getSystemSettingsService()
        expect(result).toMatchObject({
            logoSrc: `/logo.webp?v=${updated.getTime()}`,
            logoSrc64: `/logo-64.webp?v=${updated.getTime()}`,
            faviconSrc: `/favicon.ico?v=${updated.getTime()}`,
            isPublicRegistrationEnabled: true,
            isMaintenanceModeEnabled: true,
            isMaintenanceModeScheduled: true,
            maintenanceStartsAt: '2026-12-01T12:00:00Z',
        })
        expect(result.pendingMaintenanceExtensionRequest).toMatchObject({
            id: 'request',
            user: { id: 'member', username: 'Ada' },
            requestedAt: updated.toISOString(),
        })
        expect(maintenance).toHaveBeenCalledWith(rawSettings, expect.any(Date))
        expect(getVersion(updated)).toBe(updated.getTime())
        expect(getVersion(null)).toBe(0)
    })

    it('returns null when no extension request is pending', async () => {
        expect(
            (await getSystemSettingsService())
                .pendingMaintenanceExtensionRequest,
        ).toBeNull()
    })

    it('propagates a settings read error without exposing partial configuration', async () => {
        settings.mockRejectedValue(new Error('Unavailable'))
        await expect(getSystemSettingsService()).rejects.toThrow('Unavailable')
        expect(pending).not.toHaveBeenCalled()
    })
})
