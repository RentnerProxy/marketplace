import type { RealtimeConnectionData } from '@/websockets/Types/bun.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'

export type SessionValidationTestRevocationEvent = Extract<
    RealtimeEvent,
    {
        type:
            | 'user.updated'
            | 'user.access-revoked'
            | 'session.revoked'
            | 'realtime.reauthentication-required'
            | 'user.sessions-revoked'
    }
>

export type SessionValidationTestUpgradeConnection = {
    data: RealtimeConnectionData | null
}

export type SessionValidationTestPredicate = { column: unknown; value: unknown }
export type SessionValidationTestTimer = {
    handle: ReturnType<typeof setTimeout>
    wakeAt: number
    hasRun: boolean
    run: () => void
}
