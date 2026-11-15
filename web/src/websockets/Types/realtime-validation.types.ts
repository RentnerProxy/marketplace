import type { UserSessionsRevokedEvent } from './events.ts'

export type RealtimeValidationState = {
    expiresAtMs: number
    absoluteExpiresAtMs: number
    expiryTimer: ReturnType<typeof setTimeout> | null
    revalidationTimer: ReturnType<typeof setInterval> | null
    isValidating: boolean
    generation: symbol
    isSuspended: boolean
    hasAnnouncedReady: boolean
    pendingRevocation: UserSessionsRevokedEvent | null
}
