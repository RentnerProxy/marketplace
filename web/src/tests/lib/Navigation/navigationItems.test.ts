import { describe, expect, it } from 'bun:test'
import { FileText, LayoutDashboard, Users } from 'lucide-react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { NAVBAR_ITEMS } from '@/config/navbar.config.ts'
import { getVisibleNavigationItems } from '@/lib/Navigation/navigationItems.ts'
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
        ).toEqual(['/user/app-submissions', '/people'])
        expect(
            getVisibleNavigationItems(NAVBAR_ITEMS, [
                PERMISSIONS.ADMIN_MARKETPLACE_REVIEW,
            ]),
        ).toMatchObject([
            { labelKey: 'nav.staff', children: [{ to: '/admin/app-reviews' }] },
            { labelKey: 'nav.people', to: '/people' },
        ])
    })

    it('shows separate navigation groups and limits team management to superusers', () => {
        const delegated = getVisibleNavigationItems(NAVBAR_ITEMS, [
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
        ])
        const owner = getVisibleNavigationItems(NAVBAR_ITEMS, [
            PERMISSIONS.ADMIN_USER_MANAGEMENT,
            PERMISSIONS.ADMIN_SUPER_USER,
        ])
        expect(delegated).toMatchObject([
            { labelKey: 'nav.staff', children: [{ to: '/admin/users' }] },
            { labelKey: 'nav.people', to: '/people' },
        ])
        expect(
            owner
                .find((item) => item.labelKey === 'nav.staff')
                ?.children?.map(({ to }) => to),
        ).toEqual(['/admin/users', '/admin/staff', '/admin/staff-invitations'])
        expect(
            owner.find((item) => item.labelKey === 'nav.admin'),
        ).toMatchObject({
            children: [{ to: '/admin/permissions' }],
        })
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

    it('keeps system administration, staff operations, and personal routes separate', () => {
        const visibleItems = getVisibleNavigationItems(
            NAVBAR_ITEMS,
            Object.values(PERMISSIONS),
            true,
        )
        expect(visibleItems).toMatchObject([
            {
                labelKey: 'nav.admin',
                children: [
                    { to: '/admin/dashboard' },
                    { to: '/admin/system-settings' },
                    { to: '/admin/permissions' },
                    { to: '/admin/audit-logs' },
                    { to: '/admin/backups' },
                    { to: '/admin/app-namespaces' },
                ],
            },
            {
                labelKey: 'nav.staff',
                children: [
                    { to: '/admin/users' },
                    { to: '/admin/staff' },
                    { to: '/admin/staff-invitations' },
                    { to: '/admin/app-reviews' },
                ],
            },
            { to: '/user/dashboard' },
            { to: '/user/app-submissions' },
            { to: '/people' },
        ])
    })
})
