import type { TotpFactor } from '@/server/Auth/Types/totp.types.ts'

export type TotpPredicateEquality = {
    field: keyof TotpFactor
    value: unknown
}

export type TotpReplayTestState = {
    rows: Array<TotpFactor>
    conditions: Array<Array<TotpPredicateEquality>>
    attemptedUpdates: number
    successfulWrites: number
    beforeCompare: (() => void) | null
    databaseFailure: Error | null
    failAfterWrite: boolean
}
