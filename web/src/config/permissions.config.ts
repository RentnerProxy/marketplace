import type {
    PermissionKey,
    PermissionDefinition,
} from '@/shared/Types/config.types.ts'
export const PERMISSIONS = {
    ADMIN_DASHBOARD: 'admin.dashboard',
    ADMIN_USER_MANAGEMENT: 'admin.userManagement',
    ADMIN_SYSTEM_SETTINGS: 'admin.systemSettings',
    ADMIN_MAINTENANCE_BYPASS: 'admin.maintenanceBypass',
    ADMIN_SUPER_USER: 'admin.superUser',
    USER_DASHBOARD: 'user.dashboard',
    ADMIN_AUDIT_LOGS: 'admin.auditLogs',
    ADMIN_BACKUPS: 'admin.backups',
} as const

export const PUBLIC_PERMISSION_KEYS: ReadonlyArray<string> = [
    PERMISSIONS.USER_DASHBOARD,
] satisfies Array<PermissionKey>

export const DEFAULT_PERMISSIONS = [
    {
        key: PERMISSIONS.ADMIN_DASHBOARD,
        name: 'Admin Dashboard',
        description: 'Darf das Admin Dashboard öffnen.',
    },
    {
        key: PERMISSIONS.ADMIN_USER_MANAGEMENT,
        name: 'Öffentliche Konten',
        description: 'Darf öffentlich registrierte Konten verwalten.',
    },
    {
        key: PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        name: 'Systemeinstellungen',
        description: 'Darf Logo, Firmenname und Systemoptionen verwalten.',
    },
    {
        key: PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
        name: 'Wartungsmodus umgehen',
        description: 'Bleibt auch bei aktivem Wartungsmodus eingeloggt.',
    },
    {
        key: PERMISSIONS.ADMIN_SUPER_USER,
        name: 'Superuser',
        description:
            'Darf Teamkonten einladen und verwalten sowie Teamrechte und öffentliche Standardrechte konfigurieren.',
    },
    {
        key: PERMISSIONS.USER_DASHBOARD,
        name: 'User Dashboard',
        description: 'Darf das User Dashboard öffnen.',
    },
    {
        key: PERMISSIONS.ADMIN_AUDIT_LOGS,
        name: 'Audit Logs',
        description: 'Darf die Audit Logs öffnen.',
    },
    {
        key: PERMISSIONS.ADMIN_BACKUPS,
        name: 'Backups',
        description:
            'Darf Backups konfigurieren, exportieren und wiederherstellen.',
    },
] satisfies Array<PermissionDefinition>

export const DEFAULT_ADMIN_PERMISSION_KEYS: Array<string> = [
    PERMISSIONS.ADMIN_DASHBOARD,
    PERMISSIONS.ADMIN_USER_MANAGEMENT,
    PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
    PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
    PERMISSIONS.ADMIN_SUPER_USER,
    PERMISSIONS.ADMIN_AUDIT_LOGS,
    PERMISSIONS.ADMIN_BACKUPS,
] satisfies Array<PermissionKey>
