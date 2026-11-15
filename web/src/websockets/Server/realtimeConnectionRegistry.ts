import {
    closeRealtimeSession,
    enforceRealtimeSessionDeadline,
    invalidateRealtimeRevocationEpoch,
    suspendRealtimeSessionForRevalidation,
} from './realtimeSessionValidation.ts'
import type {
    BunRealtimeServer,
    BunRealtimeWebSocket,
} from '@/websockets/Types/bun.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'

const MAX_REALTIME_CONNECTIONS_PER_USER = 10

declare global {
    var appRealtimeConnections:
        Map<string, Set<BunRealtimeWebSocket>> | undefined
}

function getRealtimeConnections() {
    globalThis.appRealtimeConnections ??= new Map()
    return globalThis.appRealtimeConnections
}

export function registerRealtimeConnection(websocket: BunRealtimeWebSocket) {
    const connections = getRealtimeConnections()
    const userConnections = connections.get(websocket.data.userId) ?? new Set()

    if (userConnections.size >= MAX_REALTIME_CONNECTIONS_PER_USER) {
        return false
    }

    userConnections.add(websocket)
    connections.set(websocket.data.userId, userConnections)
    return true
}

export function unregisterRealtimeConnection(websocket: BunRealtimeWebSocket) {
    const connections = getRealtimeConnections()
    const userConnections = connections.get(websocket.data.userId)

    userConnections?.delete(websocket)
    if (userConnections?.size === 0) {
        connections.delete(websocket.data.userId)
    }
}

function closeUserRealtimeConnections(userId: string) {
    for (const websocket of getRealtimeConnections().get(userId) ?? []) {
        closeRealtimeSession(
            websocket,
            4001,
            'Berechtigungen oder Sitzung wurden geändert.',
        )
        unregisterRealtimeConnection(websocket)
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
            unregisterRealtimeConnection(websocket)
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

    for (const userConnections of getRealtimeConnections().values()) {
        for (const websocket of userConnections) {
            if (!enforceRealtimeSessionDeadline(websocket)) {
                unregisterRealtimeConnection(websocket)
            }
        }
    }
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
