import {
    FileText,
    LayoutDashboard,
    Settings,
    Users,
    HardDriveDownload,
    KeyRound,
} from 'lucide-react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { AuthenticatedNavItem } from '@/shared/Types/navigation.types.ts'

export const NAVBAR_ITEMS = [
    {
        labelKey: 'nav.dashboard',
        to: '/admin/dashboard',
        icon: LayoutDashboard,
        permission: PERMISSIONS.ADMIN_DASHBOARD,
        title: 'admin.dashboard.title',
        description: 'admin.dashboard.description',
    },
    {
        labelKey: 'nav.userManagement',
        icon: Users,
        children: [
            {
                labelKey: 'nav.overview',
                to: '/admin/users',
                icon: Users,
                permission: PERMISSIONS.ADMIN_USER_MANAGEMENT,
                title: 'admin.users.title',
                description: 'admin.users.description',
            },
            {
                labelKey: 'nav.permissions',
                to: '/admin/permissions',
                icon: KeyRound,
                permission: PERMISSIONS.ADMIN_SUPER_USER,
                title: 'admin.permissions.title',
                description: 'admin.permissions.description',
            },
        ],
    },
    {
        labelKey: 'nav.systemSettings',
        to: '/admin/system-settings',
        icon: Settings,
        permission: PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        title: 'admin.systemSettings.title',
        description: 'admin.systemSettings.description',
    },
    {
        labelKey: 'nav.auditLogs',
        to: '/admin/audit-logs',
        icon: FileText,
        permission: PERMISSIONS.ADMIN_AUDIT_LOGS,
        title: 'admin.auditLogs.pageTitle',
        description: 'admin.auditLogs.pageDescription',
    },
    {
        labelKey: 'nav.backups',
        to: '/admin/backups',
        icon: HardDriveDownload,
        permission: PERMISSIONS.ADMIN_BACKUPS,
        title: 'admin.backups.title',
        description: 'admin.backups.description',
    },
    {
        labelKey: 'nav.dashboard',
        to: '/user/dashboard',
        icon: LayoutDashboard,
        permission: PERMISSIONS.USER_DASHBOARD,
        title: 'user.dashboard.title',
        description: 'user.dashboard.loggedIn',
    },
] satisfies Array<AuthenticatedNavItem>
