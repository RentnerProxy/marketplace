import { PERMISSIONS } from '@/config/permissions.config.ts'

function getProtectedRealtimeTopicAccess(permissionKeys: Array<string>) {
    return {
        adminUsers:
            permissionKeys.includes(PERMISSIONS.ADMIN_USER_MANAGEMENT) ||
            permissionKeys.includes(PERMISSIONS.ADMIN_SUPER_USER),
        adminAuditLogs: permissionKeys.includes(PERMISSIONS.ADMIN_AUDIT_LOGS),
        adminMaintenance: permissionKeys.includes(
            PERMISSIONS.ADMIN_SYSTEM_SETTINGS,
        ),
    }
}

export function shouldReconnectForPermissionChange(
    previousPermissionKeys: Array<string>,
    permissionKeys: Array<string>,
) {
    const previousTopicAccess = getProtectedRealtimeTopicAccess(
        previousPermissionKeys,
    )
    const nextTopicAccess = getProtectedRealtimeTopicAccess(permissionKeys)

    return (
        previousTopicAccess.adminUsers !== nextTopicAccess.adminUsers ||
        previousTopicAccess.adminAuditLogs !== nextTopicAccess.adminAuditLogs ||
        previousTopicAccess.adminMaintenance !==
            nextTopicAccess.adminMaintenance
    )
}
