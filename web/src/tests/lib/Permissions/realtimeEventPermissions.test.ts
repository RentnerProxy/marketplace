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

    it('verbindet nicht neu, solange der Zugriff auf dasselbe Benutzer-Topic erhalten bleibt', function () {
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_USER_MANAGEMENT],
                [PERMISSIONS.ADMIN_SUPER_USER],
            ),
        ).toBe(false)
        expect(
            shouldReconnectForPermissionChange(
                [PERMISSIONS.ADMIN_SUPER_USER],
                [PERMISSIONS.ADMIN_USER_MANAGEMENT],
            ),
        ).toBe(false)
        expect(
            shouldReconnectForPermissionChange(
                [
                    PERMISSIONS.ADMIN_USER_MANAGEMENT,
                    PERMISSIONS.ADMIN_SUPER_USER,
                ],
                [PERMISSIONS.ADMIN_USER_MANAGEMENT],
            ),
        ).toBe(false)
        expect(
            shouldReconnectForPermissionChange(
                [
                    PERMISSIONS.ADMIN_USER_MANAGEMENT,
                    PERMISSIONS.ADMIN_SUPER_USER,
                ],
                [PERMISSIONS.ADMIN_SUPER_USER],
            ),
        ).toBe(false)
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
