import type { BunRealtimeWebSocket } from '@/websockets/Types/bun.ts'

const MAX_REALTIME_CONNECTIONS_PER_USER = 10

declare global {
    var appRealtimeConnections:
        Map<string, Set<BunRealtimeWebSocket>> | undefined
}

export function getRealtimeConnections() {
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
