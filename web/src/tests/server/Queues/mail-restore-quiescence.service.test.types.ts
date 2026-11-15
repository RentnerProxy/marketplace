import type { vi } from 'bun:test'
export type QueueState = {
    activeCounts: Array<number>
    close: ReturnType<typeof vi.fn>
    delayedIds: Array<string>
    isPaused: boolean
    pause: ReturnType<typeof vi.fn>
    pausedIds: Array<string>
    prioritizedIds: Array<string>
    remove: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    waitIds: Array<string>
    waitingChildrenIds: Array<string>
}
