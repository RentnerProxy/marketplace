export type LoginAttempt = {
    generation: string
    attemptId: string
    expiresAtMs: number
}

export type LoginAttemptOutcome = 'success' | 'failure' | 'neutral'

export type ReserveLoginAttemptResult =
    | { allowed: true; attempt: LoginAttempt }
    | {
          allowed: false
          reason: 'locked' | 'busy'
          retryAfterSeconds: number
          lockCreated: boolean
      }

export type LoginFailureResult = {
    lockCreated: boolean
    lockDurationSeconds: number
}

export type FinishLoginAttemptResult = LoginFailureResult & {
    applied: boolean
}

export type LoginAttemptOperation = 'reserve' | 'finish' | 'recovery-failure'
