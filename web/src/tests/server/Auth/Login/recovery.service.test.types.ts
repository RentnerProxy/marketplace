import type {
    LoginRecoveryAttempt,
    LoginRecoveryGrant,
} from '@/server/Auth/Types/login-recovery.types.ts'

type RecoveryTestEntry = {
    value: string
    expiresAt: number | null
    kind: 'string' | 'hash'
}
export type RecoveryTestState = {
    now: number
    entries: Map<string, RecoveryTestEntry>
    cookies: Map<string, string>
    events: Array<string>
    connectionError: Error | null
    setError: Error | null
    evalError: Error | null
    deleteError: Error | null
    cookieError: Error | null
    deleteCookieError: Error | null
    collision: boolean
    pttlOverride: number | null
    evalOverride: { value: unknown } | null
}
export type RecoveryTestCookieOptions = {
    httpOnly: boolean
    secure: boolean
    sameSite: string
    path: string
    expires: Date
    maxAge: number
}
export type RecoveryTestIssuedGrant = {
    key: string
    token: string
    grant: LoginRecoveryGrant
    entry: RecoveryTestEntry
}
export type RecoveryTestReservedGrant = RecoveryTestIssuedGrant & {
    attempt: LoginRecoveryAttempt
}
