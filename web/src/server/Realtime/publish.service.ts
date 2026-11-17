import { dispatchRealtimeEvent } from '@/websockets/Server/realtimeConnectionRegistry.ts'
import { ensureRealtimeServer } from '@/websockets/Server/realtimeServer.ts'
import type {
    AdminPermissionsUpdatedEvent,
    AuditLogCreatedEvent,
    MaintenanceExtensionResolvedEvent,
    MaintenanceExtensionRequestedEvent,
    MaintenanceModeChangedEvent,
    NotificationCreatedEvent,
    RealtimeReauthenticationRequiredEvent,
    RealtimeEvent,
    SessionRevokedEvent,
    SystemSettingsUpdatedEvent,
    SystemRestoreChangedEvent,
    UserAccessRevokedEvent,
    UserUpdatedEvent,
    UserSessionsRevokedEvent,
} from '@/websockets/Types/events.ts'
import {
    ADMIN_AUDIT_LOGS_TOPIC,
    ADMIN_BACKUPS_TOPIC,
    ADMIN_MAINTENANCE_TOPIC,
    ADMIN_USERS_TOPIC,
    ADMIN_STAFF_TOPIC,
    MAINTENANCE_MODE_TOPIC,
    REALTIME_PUBLISH_PATH,
    SYSTEM_SETTINGS_TOPIC,
    getUserTopic,
} from '@/lib/Realtime/realtimeProtocol.ts'
import { getValkeyPublisher } from '@/server/Valkey/valkey.service.ts'
import { REALTIME_VALKEY_CHANNEL } from '@/websockets/Server/realtimeValkey.ts'
import { logError } from '@/server/Logging/logger.ts'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'

async function publishRealtimeEventViaBridgeService(
    topic: string,
    event: RealtimeEvent,
) {
    const isProduction = process.env.NODE_ENV === 'production'
    const publishUrl =
        process.env.REALTIME_PUBLISH_URL ??
        (isProduction
            ? undefined
            : `http://127.0.0.1:${process.env.REALTIME_WS_PORT ?? 3001}${REALTIME_PUBLISH_PATH}`)
    const publishSecret =
        process.env.REALTIME_PUBLISH_SECRET ??
        (isProduction ? undefined : 'tanstack-dummy-dev-realtime')

    if (!publishUrl || !publishSecret) {
        return false
    }

    const response = await fetch(publishUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-realtime-publish-secret': publishSecret,
        },
        body: JSON.stringify({ topic, event }),
    })

    if (!response.ok) {
        throw new Error(
            `Realtime publish bridge failed with ${response.status} ${response.statusText}.`,
        )
    }

    return true
}

async function publishRealtimeEventService(
    topic: string,
    event: RealtimeEvent,
) {
    if (process.env.VALKEY_URL) {
        await getValkeyPublisher().publish(
            REALTIME_VALKEY_CHANNEL,
            JSON.stringify({ topic, event }),
        )
        return
    }

    if (await publishRealtimeEventViaBridgeService(topic, event)) {
        return
    }

    const server = ensureRealtimeServer()
    dispatchRealtimeEvent(server, topic, event)
}

export async function publishSystemSettingsUpdatedService(
    payload: SystemSettingsUpdatedEvent['payload'],
) {
    await publishRealtimeEventService(SYSTEM_SETTINGS_TOPIC, {
        type: 'system-settings.updated',
        payload,
    })
}

export async function publishMaintenanceModeChangedService(
    payload: MaintenanceModeChangedEvent['payload'],
) {
    await publishRealtimeEventService(MAINTENANCE_MODE_TOPIC, {
        type: 'maintenance-mode.changed',
        payload,
    })
}

export async function publishMaintenanceExtensionResolvedService(
    payload: MaintenanceExtensionResolvedEvent['payload'],
) {
    const event = {
        type: 'maintenance-extension.resolved' as const,
        payload,
    }

    await Promise.all([
        publishRealtimeEventService(ADMIN_MAINTENANCE_TOPIC, event),
        publishRealtimeEventService(getUserTopic(payload.userId), event),
    ])
}

export async function publishMaintenanceExtensionRequestedService(
    payload: MaintenanceExtensionRequestedEvent['payload'],
) {
    await publishRealtimeEventService(ADMIN_MAINTENANCE_TOPIC, {
        type: 'maintenance-extension.requested',
        payload,
    })
}

export async function publishUserUpdatedService(
    payload: UserUpdatedEvent['payload'],
    accountType: AccountType,
) {
    await publishRealtimeEventService(getUserTopic(payload.userId), {
        type: 'user.updated',
        payload,
    })
    await publishRealtimeEventService(
        accountType === 'staff' ? ADMIN_STAFF_TOPIC : ADMIN_USERS_TOPIC,
        {
            type: 'admin-user.updated',
            payload,
        },
    )
}

export async function publishPermissionManagementUpdatedService(
    payload: AdminPermissionsUpdatedEvent['payload'],
) {
    await publishRealtimeEventService(ADMIN_STAFF_TOPIC, {
        type: 'admin-permissions.updated',
        payload,
    })
}

export async function publishNotificationCreatedService(
    payload: NotificationCreatedEvent['payload'],
) {
    await publishRealtimeEventService(getUserTopic(payload.userId), {
        type: 'notification.created',
        payload,
    })
}

export async function publishUserAccessRevokedService(
    payload: UserAccessRevokedEvent['payload'],
    accountType: AccountType,
) {
    await publishRealtimeEventService(getUserTopic(payload.userId), {
        type: 'user.access-revoked',
        payload,
    })
    await publishRealtimeEventService(
        accountType === 'staff' ? ADMIN_STAFF_TOPIC : ADMIN_USERS_TOPIC,
        {
            type: 'admin-user.access-revoked',
            payload,
        },
    )
}

export async function publishSessionRevokedService(
    payload: SessionRevokedEvent['payload'],
) {
    await publishRealtimeEventService(getUserTopic(payload.userId), {
        type: 'session.revoked',
        payload,
    })
}

export async function publishUserSessionsRevokedService(
    payload: UserSessionsRevokedEvent['payload'],
) {
    await publishRealtimeEventService(getUserTopic(payload.userId), {
        type: 'user.sessions-revoked',
        payload,
    })
}

export async function publishRealtimeReauthenticationRequiredService(
    payload: RealtimeReauthenticationRequiredEvent['payload'],
) {
    await publishRealtimeEventService(SYSTEM_SETTINGS_TOPIC, {
        type: 'realtime.reauthentication-required',
        payload,
    })
}

export async function publishSystemRestoreChangedService(
    payload: SystemRestoreChangedEvent['payload'],
) {
    await publishRealtimeEventService(SYSTEM_SETTINGS_TOPIC, {
        type: 'system-restore.changed',
        payload,
    })
}

export async function publishAuditLogCreatedService(
    payload: AuditLogCreatedEvent['payload'],
) {
    await publishRealtimeEventService(ADMIN_AUDIT_LOGS_TOPIC, {
        type: 'audit-log.created',
        payload,
    })
}

export async function publishAdminBackupsChangedService() {
    try {
        await publishRealtimeEventService(ADMIN_BACKUPS_TOPIC, {
            type: 'admin-backups.changed',
            payload: { updatedAt: new Date().toISOString() },
        })
    } catch (error) {
        logError('backup.realtime_publish_failed', error)
    }
}
