import { describe, expect, it } from 'bun:test'
import { FileText, LayoutDashboard, Users } from 'lucide-react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { NAVBAR_ITEMS } from '@/config/navbar.config.ts'
import {
    flattenNavigationRoutes,
    getVisibleNavigationItems,
} from '@/lib/Navigation/navigationItems.ts'
import type { AuthenticatedNavItem } from '@/shared/Types/navigation.types.ts'

const nestedNavigation: Array<AuthenticatedNavItem> = [
    {
        labelKey: 'dashboard',
        to: '/admin/dashboard',
        icon: LayoutDashboard,
        permission: PERMISSIONS.ADMIN_DASHBOARD,
    },
    {
        labelKey: 'users',
        icon: Users,
        children: [
            {
                labelKey: 'levelTwo',
                icon: Users,
                children: [
                    {
                        labelKey: 'allowed',
                        to: '/admin/audit-logs',
                        icon: FileText,
                        permission: PERMISSIONS.ADMIN_AUDIT_LOGS,
                    },
                    {
                        labelKey: 'hidden',
                        to: '/admin/backups',
                        icon: FileText,
                        permission: PERMISSIONS.ADMIN_BACKUPS,
                    },
                ],
            },
        ],
    },
]

describe('Sidebar-Navigation', function () {
    it('trennt Übersicht und Rechte im Userverwaltungs-Menü nach Permission', function () {
        const userManagerItems = getVisibleNavigationItems(NAVBAR_ITEMS, [
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        ])
        const superUserItems = getVisibleNavigationItems(NAVBAR_ITEMS, [
            PERMISSIONS.ADMIN_SUPER_USER,
        ])
        const combinedItems = getVisibleNavigationItems(NAVBAR_ITEMS, [
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
            PERMISSIONS.ADMIN_SUPER_USER,
        ])

        expect(
            userManagerItems
                .find((item) => item.labelKey === 'nav.userManagement')
                ?.children?.map((item) => item.labelKey),
        ).toEqual(['nav.overview'])
        expect(
            superUserItems
                .find((item) => item.labelKey === 'nav.userManagement')
                ?.children?.map((item) => item.labelKey),
        ).toEqual(['nav.permissions'])
        expect(
            combinedItems
                .find((item) => item.labelKey === 'nav.userManagement')
                ?.children?.map((item) => item.labelKey),
        ).toEqual(['nav.overview', 'nav.permissions'])
    })

    it('filtert Berechtigungen über beliebig tiefe Child-Ebenen', function () {
        const visibleItems = getVisibleNavigationItems(nestedNavigation, [
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.ADMIN_AUDIT_LOGS,
        ])

        expect(visibleItems[1]?.children?.[0]?.children).toHaveLength(1)
        expect(visibleItems[1]?.children?.[0]?.children?.[0]?.labelKey).toBe(
            'allowed',
        )
    })

    it('behält beim Einklappen die Reihenfolge aller erreichbaren Routen', function () {
        const visibleItems = getVisibleNavigationItems(nestedNavigation, [
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.ADMIN_AUDIT_LOGS,
        ])
        const collapsedItems = flattenNavigationRoutes(visibleItems)

        expect(collapsedItems.map((item) => item.to)).toEqual([
            '/admin/dashboard',
            '/admin/audit-logs',
        ])
        expect(collapsedItems.every((item) => !item.children)).toBe(true)
    })
})
