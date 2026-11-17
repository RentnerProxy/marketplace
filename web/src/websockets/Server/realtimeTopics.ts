import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import {
    ADMIN_AUDIT_LOGS_TOPIC,
    ADMIN_BACKUPS_TOPIC,
    ADMIN_MAINTENANCE_TOPIC,
    ADMIN_USERS_TOPIC,
    ADMIN_STAFF_TOPIC,
    MAINTENANCE_MODE_TOPIC,
    SYSTEM_SETTINGS_TOPIC,
    getUserTopic,
} from '@/lib/Realtime/realtimeProtocol.ts'
import type { RealtimeConnectionData } from '@/websockets/Types/bun.ts'

export function getRealtimeConnectionTopics(
    data: RealtimeConnectionData,
): Array<string> {
    const topics = [
        SYSTEM_SETTINGS_TOPIC,
        MAINTENANCE_MODE_TOPIC,
        getUserTopic(data.userId),
    ]
    if (hasPermission(data.permissions, PERMISSIONS.ADMIN_USER_MANAGEMENT))
        topics.push(ADMIN_USERS_TOPIC)
    if (hasPermission(data.permissions, PERMISSIONS.ADMIN_SUPER_USER))
        topics.push(ADMIN_STAFF_TOPIC)
    if (hasPermission(data.permissions, PERMISSIONS.ADMIN_AUDIT_LOGS))
        topics.push(ADMIN_AUDIT_LOGS_TOPIC)
    if (hasPermission(data.permissions, PERMISSIONS.ADMIN_BACKUPS))
        topics.push(ADMIN_BACKUPS_TOPIC)
    if (hasPermission(data.permissions, PERMISSIONS.ADMIN_SYSTEM_SETTINGS))
        topics.push(ADMIN_MAINTENANCE_TOPIC)
    return topics
}
