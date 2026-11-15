import type { RealtimeEvent } from './events.ts'

export type RealtimeEventListener = (
    event: RealtimeEvent,
) => void | Promise<void>
