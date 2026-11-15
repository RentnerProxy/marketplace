import { PERMISSIONS } from '@/config/permissions.config.ts'

export const DEFAULT_ROUTE_PRIORITY = [
    {
        permission: PERMISSIONS.ADMIN_DASHBOARD,
        route: '/admin/dashboard',
    },
    {
        permission: PERMISSIONS.USER_DASHBOARD,
        route: '/user/dashboard',
    },
] as const

export const ROUTE_PERMISSIONS = {
    '/admin/dashboard': PERMISSIONS.ADMIN_DASHBOARD,
    '/admin/users': PERMISSIONS.ADMIN_USER_MANAGEMENT,
    '/admin/permissions': PERMISSIONS.ADMIN_SUPER_USER,
    '/admin/system-settings': PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
    '/user/dashboard': PERMISSIONS.USER_DASHBOARD,
    '/admin/audit-logs': PERMISSIONS.ADMIN_AUDIT_LOGS,
    '/admin/backups': PERMISSIONS.ADMIN_BACKUPS,
}
