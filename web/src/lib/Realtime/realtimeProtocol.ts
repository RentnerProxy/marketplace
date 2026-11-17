export const REALTIME_WS_PATH = '/ws'
export const REALTIME_PUBLISH_PATH = '/__internal/realtime/publish'
export const SYSTEM_SETTINGS_TOPIC = 'system-settings'
export const MAINTENANCE_MODE_TOPIC = 'maintenance-mode'
export const ADMIN_MAINTENANCE_TOPIC = 'admin-maintenance'
export const ADMIN_USERS_TOPIC = 'admin-users'
export const ADMIN_STAFF_TOPIC = 'admin-staff'
export const ADMIN_AUDIT_LOGS_TOPIC = 'admin-audit-logs'
export const ADMIN_BACKUPS_TOPIC = 'admin-backups'

export function getUserTopic(userId: string) {
    return `user:${userId}`
}
