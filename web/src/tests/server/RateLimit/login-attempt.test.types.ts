import type { LoginAttempt } from '@/server/RateLimit/Types/login-attempt.types.ts'

export type LoginAttemptTestAccount = {
    history: {
        failures: number
        stage: number
        expiresAt: number | null
    } | null
    lock: { expiresAt: number | null } | null
    generation: string | null
    generationExpiresAt: number | null
    inflight: Map<string, LoginAttempt>
    inflightExpiresAt: number | null
}
export type LoginAttemptTestModel = {
    now: number
    accounts: Map<string, LoginAttemptTestAccount>
}
export type LoginAttemptTestReply = [
    string,
    string,
    string,
    number,
    number,
    number,
]
