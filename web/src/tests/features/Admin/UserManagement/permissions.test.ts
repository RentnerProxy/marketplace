import { describe, expect, it } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/shared/Types/config.types.ts'
import { ROUTE_PERMISSIONS } from '@/config/routes.config.ts'
import {
    getDefaultRouteForPermissions,
    getPermissionForRoute,
    getVisiblePermissionKeys,
    hasPermission,
    hasSuperUserPermission,
} from '@/lib/Permissions/permissions.ts'

describe('Permission-Helfer', function () {
    it('erkennt vorhandene und fehlende Permissions', function () {
        const permissions = [
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        ]

        expect(hasPermission(permissions, PERMISSIONS.ADMIN_DASHBOARD)).toBe(
            true,
        )
        expect(
            hasPermission(permissions, PERMISSIONS.ADMIN_SYSTEM_SETTINGS),
        ).toBe(false)
        expect(hasPermission(undefined, PERMISSIONS.ADMIN_DASHBOARD)).toBe(
            false,
        )
    })

    it('erkennt Superuser und blendet Superuser-Rechte ohne Zugriff aus', function () {
        const permissions = [
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.ADMIN_SUPER_USER,
        ]

        expect(hasSuperUserPermission(permissions)).toBe(true)
        expect(getVisiblePermissionKeys(permissions, true)).toEqual(permissions)
        expect(getVisiblePermissionKeys(permissions, false)).toEqual([
            PERMISSIONS.ADMIN_DASHBOARD,
        ])
    })

    it('ermittelt Default-Routes nach Permission-Priorität', function () {
        expect(
            getDefaultRouteForPermissions([
                PERMISSIONS.USER_DASHBOARD,
                PERMISSIONS.ADMIN_DASHBOARD,
            ]),
        ).toBe('/admin/dashboard')
    })

    it('verwendet bei Admin-Rechten nur tatsächlich erlaubte Routen', function () {
        const auditRoute = getDefaultRouteForPermissions([
            PERMISSIONS.ADMIN_AUDIT_LOGS,
        ])

        expect(auditRoute).toBe('/admin/audit-logs')
        expect(auditRoute).not.toBe('/admin/dashboard')
        expect(
            getDefaultRouteForPermissions([PERMISSIONS.ADMIN_USER_MANAGEMENT]),
        ).toBe('/admin/users')
        expect(
            getDefaultRouteForPermissions([PERMISSIONS.ADMIN_SUPER_USER]),
        ).toBe('/admin/permissions')
    })

    it('liefert für jede konfigurierte Route nur eine vorhandene Permission', function () {
        for (const permission of Object.values(ROUTE_PERMISSIONS)) {
            const permissions: PermissionKey[] = [permission]
            const defaultRoute = getDefaultRouteForPermissions(permissions)
            const requiredPermission = getPermissionForRoute(defaultRoute)

            expect(requiredPermission).toBeDefined()
            expect(requiredPermission).toBe(permission)
        }
    })

    it('fällt ohne nutzbare Route auf Login zurück', function () {
        expect(
            getDefaultRouteForPermissions([
                PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
            ]),
        ).toBe('/login')

        expect(getDefaultRouteForPermissions([])).toBe('/login')
    })

    it('normalisiert Route-Pfade vor der Permission-Zuordnung', function () {
        expect(getPermissionForRoute('/admin/users')).toBe(
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        )
        expect(getPermissionForRoute('/admin/users/?tab=active#top')).toBe(
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        )
        expect(getPermissionForRoute('/admin/permissions')).toBe(
            PERMISSIONS.ADMIN_SUPER_USER,
        )
        expect(getPermissionForRoute('/admin/unbekannt')).toBeUndefined()
    })
})
