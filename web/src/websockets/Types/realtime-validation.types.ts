import type { UserSessionsRevokedEvent } from './events.ts'
import type { BunRealtimeWebSocket } from './bun.ts'

export type RealtimeDeadlineEntry<Key> = { key: Key; deadline: number }

export type RealtimeSessionGroup = {
    sessionHash: string
    sockets: Set<BunRealtimeWebSocket>
    dueAtMs: number
    isValidating: boolean
}

export type RealtimeValidationState = {
    expiresAtMs: number
    absoluteExpiresAtMs: number
    group: RealtimeSessionGroup
    generation: symbol
    isSuspended: boolean
    hasAnnouncedReady: boolean
    pendingRevocation: UserSessionsRevokedEvent | null
}

export type RealtimeSessionSnapshot = {
    userId: string
    username: string
    expiresAtMs: number
    permissions: Array<string>
}

export type RealtimeValidationSubject = {
    websocket: BunRealtimeWebSocket
    state: RealtimeValidationState
    generation: symbol
}
