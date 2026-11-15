import type { QueryClient } from '@tanstack/react-query'
import type { SessionRevalidationResult } from '@/lib/Queries/Types/session-revalidation.types.ts'

export type SessionRevocationControllerOptions = {
    queryClient: QueryClient
    validate: (signal: AbortSignal) => Promise<SessionRevalidationResult>
    monotonicNow: () => number
    schedule: (callback: () => void, delayMs: number) => () => void
    throttleMs: number
}

export type SessionRevocationController = {
    request: (userId: string) => void
    dispose: () => void
}
