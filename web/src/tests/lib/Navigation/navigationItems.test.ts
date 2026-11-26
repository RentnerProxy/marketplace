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
        labelKey: 'nav.dashboard',
        to: '/admin/dashboard',
        icon: LayoutDashboard,
        permission: PERMISSIONS.ADMIN_DASHBOARD,
    },
    {
        labelKey: 'nav.userManagement',
        icon: Users,
        children: [
            {
                labelKey: 'nav.overview',
                icon: Users,
                children: [
                    {
                        labelKey: 'nav.auditLogs',
                        to: '/admin/audit-logs',
                        icon: FileText,
                        permission: PERMISSIONS.ADMIN_AUDIT_LOGS,
                    },
                    {
                        labelKey: 'nav.backups',
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
    it('shows submission and staff review routes to their respective accounts', () => {
        expect(
            getVisibleNavigationItems(NAVBAR_ITEMS, [], true).map(
                ({ to }) => to,
            ),
        ).toEqual(['/user/app-submissions'])
        expect(
            getVisibleNavigationItems(NAVBAR_ITEMS, [
                PERMISSIONS.ADMIN_MARKETPLACE_REVIEW,
            ]).map(({ to }) => to),
        ).toEqual(['/admin/app-reviews'])
    })

    it('shows separate navigation groups and limits team management to superusers', () => {
        const delegated = getVisibleNavigationItems(NAVBAR_ITEMS, [
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        ])
        const owner = getVisibleNavigationItems(NAVBAR_ITEMS, [
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
            PERMISSIONS.ADMIN_SUPER_USER,
        ])
        expect(
            delegated.find((item) => item.labelKey === 'nav.staff'),
        ).toBeUndefined()
        expect(flattenNavigationRoutes(delegated).map(({ to }) => to)).toEqual([
            '/admin/users',
        ])
        expect(
            owner.find((item) => item.labelKey === 'nav.publicAccounts')?.to,
        ).toBe('/admin/users')
        expect(
            owner
                .find((item) => item.labelKey === 'nav.staff')
                ?.children?.map(({ to }) => to),
        ).toEqual([
            '/admin/staff',
            '/admin/staff-invitations',
            '/admin/permissions',
        ])
    })

    it('filtert Berechtigungen über beliebig tiefe Child-Ebenen', function () {
        const visibleItems = getVisibleNavigationItems(nestedNavigation, [
            PERMISSIONS.ADMIN_DASHBOARD,
            PERMISSIONS.ADMIN_AUDIT_LOGS,
        ])

        expect(visibleItems[1]?.children?.[0]?.children).toHaveLength(1)
        expect(visibleItems[1]?.children?.[0]?.children?.[0]?.labelKey).toBe(
            'nav.auditLogs',
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
