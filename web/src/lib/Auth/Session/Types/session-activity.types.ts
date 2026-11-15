import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'

export type SessionActivityTouchResult =
    { active: false } | { active: true; expiresAt: string }

export type SessionActivitySnapshot = {
    revision: number
    session: AuthenticatedSessionQueryData | undefined
}

export type SessionActivityControllerOptions = {
    target: EventTarget
    isVisible: () => boolean
    getSnapshot: () => SessionActivitySnapshot
    touchSession: (signal: AbortSignal) => Promise<SessionActivityTouchResult>
    readSession: (signal: AbortSignal) => Promise<AuthenticatedSessionQueryData>
    commitSession: (
        expected: SessionActivitySnapshot,
        session: AuthenticatedSessionQueryData,
    ) => boolean
    onInactive: () => void
    wallNow: () => number
    monotonicNow: () => number
    schedule: (callback: () => void, delayMs: number) => () => void
    idleDurationMs: number
    activityThrottleMs: number
    activityReadRetryLimit: number
    activityRequestTimeoutMs: number
}

export type SessionActivityRequest = {
    signal: AbortSignal
    cancellation: Promise<never>
    cancel: () => void
    cancelTimeout: () => void
}

export type SessionActivityController = {
    refresh: () => void
    dispose: () => void
}
