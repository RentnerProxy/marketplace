import type { QueryClient } from '@tanstack/react-query'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'

export type SessionRevalidationResult =
    'active' | 'inactive' | 'stale' | 'unavailable'

export type SessionRevalidationOptions = {
    queryClient: QueryClient
    signal: AbortSignal
    readSession: (signal: AbortSignal) => Promise<AuthenticatedSessionQueryData>
    onInactive: () => void
    requestTimeoutMs: number
    schedule: (callback: () => void, delayMs: number) => () => void
}
