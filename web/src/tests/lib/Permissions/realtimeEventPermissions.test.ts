import { describe, expect, it } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { shouldReconnectForPermissionChange } from '@/lib/Permissions/realtimeEventPermissions.ts'

describe('Realtime Permission-Topic-Zugriff', function () {
    it('verbindet bei vollständigem Gewinn oder Verlust des Topic-Zugriffs neu', function () {
        expect(
            shouldReconnectForPermissionChange(
                [],
                [PERMISSIONS.ADMIN_USER_MANAGEMENT],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_USER_MANAGEMENT],
                [],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [],
                [PERMISSIONS.ADMIN_SUPER_USER],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_SUPER_USER],
                [],
            ),
        ).toBe(true)
    })

    it('reconnects when staff and public account topics change', function () {
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_USER_MANAGEMENT],
                [PERMISSIONS.ADMIN_SUPER_USER],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_SUPER_USER],
                [PERMISSIONS.ADMIN_USER_MANAGEMENT],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [
                    PERMISSIONS.ADMIN_USER_MANAGEMENT,
                    PERMISSIONS.ADMIN_SUPER_USER,
                ],
                [PERMISSIONS.ADMIN_USER_MANAGEMENT],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [
                    PERMISSIONS.ADMIN_USER_MANAGEMENT,
                    PERMISSIONS.ADMIN_SUPER_USER,
                ],
                [PERMISSIONS.ADMIN_SUPER_USER],
            ),
        ).toBe(true)
    })

    it('verbindet bei Änderungen ohne Topic-Zugriff nicht neu', function () {
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_DASHBOARD],
                [PERMISSIONS.USER_DASHBOARD],
            ),
        ).toBe(false)
    })

    it('verbindet bei Änderungen der Audit- und Wartungs-Topics neu', function () {
        expect(
            shouldReconnectForPermissionChange(
                [],
                [PERMISSIONS.ADMIN_AUDIT_LOGS],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_AUDIT_LOGS],
                [],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [],
                [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
                [],
            ),
        ).toBe(true)
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_AUDIT_LOGS],
                [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
            ),
        ).toBe(true)
    })
})
