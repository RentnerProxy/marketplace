import { normalizePermissionKeys } from '@/lib/Permissions/permissionCollections.ts'
import { describe, expect, it } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    evaluateUserUpdatePermissionPolicy,
    getPermissionAssignmentError,
    getUnknownPermissionKeys,
    LAST_ACTIVE_SUPER_USER_ERROR,
    PERMISSION_ASSIGNMENT_FORBIDDEN_ERROR,
    removesLastActiveSuperUser,
    UNKNOWN_PERMISSION_ERROR,
} from '@/server/Admin/UserManagement/permissionPolicy.service.ts'

describe('UserManagement Permission-Policy', function () {
    it('normalisiert Permission-Keys und erkennt unbekannte Werte', function () {
        const requestedPermissionKeys = normalizePermissionKeys([
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.ADMIN_DASHBOARD,
            'admin.unbekannt',
        ])
        const unknownPermissionKeys = getUnknownPermissionKeys(
            requestedPermissionKeys,
            [PERMISSIONS.ADMIN_DASHBOARD],
        )

        expect(requestedPermissionKeys).toEqual([
            PERMISSIONS.ADMIN_DASHBOARD,
            'admin.unbekannt',
        ])
        expect(unknownPermissionKeys).toEqual(['admin.unbekannt'])
        expect(UNKNOWN_PERMISSION_ERROR).toContain('unbekannt')
    })

    it('erlaubt Nicht-Superusern keine Zuweisung oder Entfernung von Rechten', function () {
        const previousPermissionKeys = [
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        ]

        expect(
            getPermissionAssignmentError({
                currentUserIsSuperUser: false,
                previousPermissionKeys,
                nextPermissionKeys: previousPermissionKeys.map(
                    (_, index) =>
                        previousPermissionKeys[
                            previousPermissionKeys.length - index - 1
                        ],
                ),
            }),
        ).toBeNull()
        expect(
            getPermissionAssignmentError({
                currentUserIsSuperUser: false,
                previousPermissionKeys,
                nextPermissionKeys: [
                    ...previousPermissionKeys,
                    PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
                ],
            }),
        ).toBe(PERMISSION_ASSIGNMENT_FORBIDDEN_ERROR)
        expect(
            getPermissionAssignmentError({
                currentUserIsSuperUser: false,
                previousPermissionKeys,
                nextPermissionKeys: [PERMISSIONS.ADMIN_USER_MANAGEMENT],
            }),
        ).toBe(PERMISSION_ASSIGNMENT_FORBIDDEN_ERROR)
    })

    it('erlaubt Superusern die Rechteverwaltung', function () {
        expect(
            getPermissionAssignmentError({
                currentUserIsSuperUser: true,
                previousPermissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
                nextPermissionKeys: [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
            }),
        ).toBeNull()
    })

    it('schützt den letzten aktiven Superuser vor Zugriffsverlust', function () {
        const previousPermissionKeys = [
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
            PERMISSIONS.ADMIN_SUPER_USER,
        ]
        const nextPermissionKeys = [PERMISSIONS.ADMIN_USER_MANAGEMENT]

        expect(
            removesLastActiveSuperUser({
                targetUserIsActive: true,
                targetUserWillBeActive: true,
                previousPermissionKeys,
                nextPermissionKeys,
                activeSuperUserCount: 1,
            }),
        ).toBe(true)
        expect(
            removesLastActiveSuperUser({
                targetUserIsActive: true,
                targetUserWillBeActive: true,
                previousPermissionKeys,
                nextPermissionKeys,
                activeSuperUserCount: 2,
            }),
        ).toBe(false)
        expect(
            removesLastActiveSuperUser({
                targetUserIsActive: false,
                targetUserWillBeActive: false,
                previousPermissionKeys,
                nextPermissionKeys,
                activeSuperUserCount: 1,
            }),
        ).toBe(false)
        expect(
            removesLastActiveSuperUser({
                targetUserIsActive: true,
                targetUserWillBeActive: false,
                previousPermissionKeys,
                nextPermissionKeys: previousPermissionKeys,
                activeSuperUserCount: 1,
            }),
        ).toBe(true)
        expect(
            removesLastActiveSuperUser({
                targetUserIsActive: true,
                targetUserWillBeActive: false,
                previousPermissionKeys,
                nextPermissionKeys: [],
                activeSuperUserCount: 1,
            }),
        ).toBe(true)
        expect(LAST_ACTIVE_SUPER_USER_ERROR).toContain('letzte aktive')
    })

    it('liefert für Updates die normalisierte Policy-Entscheidung', function () {
        expect(
            evaluateUserUpdatePermissionPolicy({
                currentUserPermissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
                previousPermissionKeys: [PERMISSIONS.ADMIN_DASHBOARD],
                permissionKeys: [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
                availablePermissionKeys: [PERMISSIONS.ADMIN_SYSTEM_SETTINGS],
                targetUserIsActive: true,
                activeSuperUserCount: 2,
            }),
        ).toEqual({
            success: true,
            permissionKeysChanged: true,
        })
        expect(
            evaluateUserUpdatePermissionPolicy({
                currentUserPermissionKeys: [PERMISSIONS.ADMIN_USER_MANAGEMENT],
                previousPermissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
                permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
                availablePermissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
                targetUserIsActive: true,
                activeSuperUserCount: 2,
            }),
        ).toEqual({
            success: false,
            error: 'Nur Superuser dürfen andere Superuser bearbeiten.',
        })
    })
})
