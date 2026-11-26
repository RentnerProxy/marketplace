import {
    closeRealtimeSession,
    expireRealtimeSessions,
    invalidateRealtimeRevocationEpoch,
    suspendRealtimeSessionForRevalidation,
} from './realtimeSessionValidation.ts'
import type { BunRealtimeServer } from '@/websockets/Types/bun.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import { invalidateMaintenanceStateService } from '@/server/Maintenance/state.service.ts'
import { getRealtimeConnections } from './realtimeConnections.ts'

export {
    registerRealtimeConnection,
    unregisterRealtimeConnection,
} from './realtimeConnections.ts'

function closeUserRealtimeConnections(userId: string) {
    for (const websocket of getRealtimeConnections().get(userId) ?? []) {
        closeRealtimeSession(
            websocket,
            4001,
            'Berechtigungen oder Sitzung wurden geändert.',
        )
    }
}

function closeAllRealtimeConnections() {
    for (const userId of getRealtimeConnections().keys()) {
        closeUserRealtimeConnections(userId)
    }
}

function closeSessionRealtimeConnections(userId: string, sessionHash: string) {
    for (const websocket of getRealtimeConnections().get(userId) ?? []) {
        if (websocket.data.sessionHash === sessionHash) {
            closeRealtimeSession(websocket, 4001, 'Die Sitzung wurde beendet.')
        }
    }
}

export function dispatchRealtimeEvent(
    server: BunRealtimeServer,
    topic: string,
    event: RealtimeEvent,
) {
    if (
        event.type === 'user.updated' ||
        event.type === 'user.access-revoked' ||
        event.type === 'session.revoked' ||
        event.type === 'realtime.reauthentication-required' ||
        event.type === 'user.sessions-revoked'
    )
        invalidateRealtimeRevocationEpoch()

    if (
        event.type === 'maintenance-mode.changed' ||
        event.type === 'system-settings.updated' ||
        event.type === 'system-restore.changed'
    )
        invalidateMaintenanceStateService()

    expireRealtimeSessions()
    if (event.type === 'user.sessions-revoked') {
        for (const websocket of getRealtimeConnections().get(
            event.payload.userId,
        ) ?? []) {
            suspendRealtimeSessionForRevalidation(websocket, event)
        }
    }
    server.publish(topic, JSON.stringify(event))

    if (event.type === 'realtime.reauthentication-required') {
        closeAllRealtimeConnections()
    } else if (
        event.type === 'user.updated' ||
        event.type === 'user.access-revoked'
    ) {
        closeUserRealtimeConnections(event.payload.userId)
    } else if (event.type === 'session.revoked') {
        closeSessionRealtimeConnections(
            event.payload.userId,
            event.payload.sessionHash,
        )
    }
}
