import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    requireAuthenticatedFeatureAccessService,
    requirePermissionService,
    requirePermissionWithSessionService,
} from '@/server/Auth/authorization.service.ts'

import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'

const authMocks = (function () {
    return {
        getActiveCurrentSessionUser: vi.fn(),
        getUserPermissionKeys: vi.fn(),
        getMaintenanceStateService: vi.fn(),
    }
})()

vi.mock('@/server/Auth/currentSession.ts', function () {
    return {
        getActiveCurrentSessionUser: authMocks.getActiveCurrentSessionUser,
    }
})

vi.mock('@/lib/Permissions/userPermissions.ts', function () {
    return {
        getUserPermissionKeys: authMocks.getUserPermissionKeys,
    }
})

vi.mock('@/server/Maintenance/state.service.ts', function () {
    return {
        getMaintenanceStateService: authMocks.getMaintenanceStateService,
    }
})

describe('serverseitige Berechtigungsprüfung', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        authMocks.getActiveCurrentSessionUser
            .mockReset()
            .mockResolvedValue(null)
        authMocks.getUserPermissionKeys.mockReset().mockResolvedValue([])
        authMocks.getMaintenanceStateService.mockReset().mockResolvedValue({
            isActive: false,
            isScheduled: false,
            startsAt: null,
        })
    })

    it('lehnt anonyme Aufrufe ab', async function () {
        authMocks.getActiveCurrentSessionUser.mockResolvedValue(null)

        await expect(
            requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT),
        ).rejects.toThrow('angemeldet')
        expect(authMocks.getUserPermissionKeys).not.toHaveBeenCalled()
        expect(authMocks.getMaintenanceStateService).not.toHaveBeenCalled()
    })

    it('lehnt Benutzer ohne erforderliche Berechtigung ab', async function () {
        authMocks.getActiveCurrentSessionUser.mockResolvedValue({
            id: 'user-id',
        })
        authMocks.getUserPermissionKeys.mockResolvedValue([
            PERMISSIONS.USER_DASHBOARD,
        ])

        await expect(
            requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT),
        ).rejects.toThrow('Berechtigung')
    })

    it('gibt den geprüften Benutzerzugriff zurück', async function () {
        authMocks.getActiveCurrentSessionUser.mockResolvedValue({
            id: 'admin-id',
            expiresAt: new Date('2026-09-01T12:00:00.000Z'),
            sessionHash: 'a'.repeat(64),
        })
        authMocks.getUserPermissionKeys.mockResolvedValue([
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        ])

        await expect(
            requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT),
        ).resolves.toEqual({
            userId: 'admin-id',
            permissionKeys: [PERMISSIONS.ADMIN_USER_MANAGEMENT],
        })
    })

    it('gibt Sitzungsmetadaten ausschließlich für gebundene interne Abläufe zurück', async function () {
        authMocks.getActiveCurrentSessionUser.mockResolvedValue({
            id: 'admin-id',
            expiresAt: new Date('2026-09-01T12:00:00.000Z'),
            sessionHash: 'a'.repeat(64),
        })
        authMocks.getUserPermissionKeys.mockResolvedValue([
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        ])

        await expect(
            requirePermissionWithSessionService(
                PERMISSIONS.ADMIN_USER_MANAGEMENT,
            ),
        ).resolves.toEqual({
            userId: 'admin-id',
            permissionKeys: [PERMISSIONS.ADMIN_USER_MANAGEMENT],
            sessionExpiresAt: new Date('2026-09-01T12:00:00.000Z'),
            sessionHash: 'a'.repeat(64),
        })
    })

    it.each([requirePermissionService, requirePermissionWithSessionService])(
        'blocks direct authorized admin calls during active maintenance',
        async function (requireAccess) {
            authMocks.getActiveCurrentSessionUser.mockResolvedValue({
                id: 'admin-id',
            })
            authMocks.getUserPermissionKeys.mockResolvedValue([
                PERMISSIONS.ADMIN_USER_MANAGEMENT,
            ])
            authMocks.getMaintenanceStateService.mockResolvedValue({
                isActive: true,
            })
            await expect(
                requireAccess(PERMISSIONS.ADMIN_USER_MANAGEMENT),
            ).rejects.toBeInstanceOf(MaintenanceModeError)
        },
    )

    it('requires bypass even to change maintenance settings once active', async function () {
        authMocks.getActiveCurrentSessionUser.mockResolvedValue({
            id: 'admin-id',
        })
        authMocks.getUserPermissionKeys.mockResolvedValue([
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        ])
        authMocks.getMaintenanceStateService.mockResolvedValue({
            isActive: true,
        })
        await expect(
            requirePermissionService(PERMISSIONS.ADMIN_SYSTEM_SETTINGS),
        ).rejects.toBeInstanceOf(MaintenanceModeError)
    })

    it.each([requirePermissionService, requirePermissionWithSessionService])(
        'does not turn maintenance bypass into a business permission',
        async function (requireAccess) {
            authMocks.getActiveCurrentSessionUser.mockResolvedValue({
                id: 'admin-id',
            })
            authMocks.getUserPermissionKeys.mockResolvedValue([
                PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
            ])
            await expect(
                requireAccess(PERMISSIONS.ADMIN_USER_MANAGEMENT),
            ).rejects.toThrow('Berechtigung')
            expect(authMocks.getMaintenanceStateService).not.toHaveBeenCalled()
        },
    )

    it.each([requirePermissionService, requirePermissionWithSessionService])(
        'allows the explicit combination of bypass and business permission',
        async function (requireAccess) {
            authMocks.getActiveCurrentSessionUser.mockResolvedValue({
                id: 'admin-id',
            })
            authMocks.getUserPermissionKeys.mockResolvedValue([
                PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
                PERMISSIONS.ADMIN_USER_MANAGEMENT,
            ])
            authMocks.getMaintenanceStateService.mockRejectedValue(
                new Error('unavailable'),
            )
            await expect(
                requireAccess(PERMISSIONS.ADMIN_USER_MANAGEMENT),
            ).resolves.toMatchObject({ userId: 'admin-id' })
        },
    )

    it('rejects anonymous calls to session-only features before reading state', async function () {
        await expect(
            requireAuthenticatedFeatureAccessService(),
        ).rejects.toThrow('angemeldet')
        expect(authMocks.getUserPermissionKeys).not.toHaveBeenCalled()
        expect(authMocks.getMaintenanceStateService).not.toHaveBeenCalled()
    })

    it('allows session-only features without adding an unrelated permission requirement', async function () {
        const sessionUser = {
            id: 'normal-user',
            sessionHash: 'b'.repeat(64),
            username: 'normal-user',
            email: 'normal@example.test',
            accountType: 'public' as const,
            emailVerifiedAt: null,
            isActive: true,
            isDeleted: false,
            expiresAt: new Date(Date.now() + 300_000),
        }
        authMocks.getActiveCurrentSessionUser.mockResolvedValue(sessionUser)
        await expect(
            requireAuthenticatedFeatureAccessService(),
        ).resolves.toEqual({
            sessionUser,
            permissionKeys: [],
        })
        expect(authMocks.getUserPermissionKeys).toHaveBeenCalledWith(
            'normal-user',
        )
    })

    it('blocks a direct session-only feature call in active maintenance', async function () {
        authMocks.getActiveCurrentSessionUser.mockResolvedValue({
            id: 'normal-user',
        })
        authMocks.getMaintenanceStateService.mockResolvedValue({
            isActive: true,
        })
        await expect(
            requireAuthenticatedFeatureAccessService(),
        ).rejects.toBeInstanceOf(MaintenanceModeError)
    })

    it('allows session-only features for the explicit bypass permission', async function () {
        authMocks.getActiveCurrentSessionUser.mockResolvedValue({
            id: 'bypass-user',
        })
        authMocks.getUserPermissionKeys.mockResolvedValue([
            PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
        ])
        authMocks.getMaintenanceStateService.mockResolvedValue({
            isActive: true,
        })
        await expect(
            requireAuthenticatedFeatureAccessService(),
        ).resolves.toMatchObject({
            sessionUser: { id: 'bypass-user' },
        })
    })

    it.each([
        () => requirePermissionService(PERMISSIONS.ADMIN_USER_MANAGEMENT),
        () =>
            requirePermissionWithSessionService(
                PERMISSIONS.ADMIN_USER_MANAGEMENT,
            ),
        requireAuthenticatedFeatureAccessService,
    ])(
        'never treats state lookup failures as ordinary access',
        async function (requireAccess) {
            authMocks.getActiveCurrentSessionUser.mockResolvedValue({
                id: 'admin-id',
            })
            authMocks.getUserPermissionKeys.mockResolvedValue([
                PERMISSIONS.ADMIN_USER_MANAGEMENT,
            ])
            const failure = new Error('state unavailable')
            authMocks.getMaintenanceStateService.mockRejectedValue(failure)
            await expect(requireAccess()).rejects.toBe(failure)
        },
    )
})
