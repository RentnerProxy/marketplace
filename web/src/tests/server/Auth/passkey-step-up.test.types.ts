import type { createPasskeyTestApi } from './passkey-step-up.test.helpers.ts'
export type PasskeyTestRow = Record<string, unknown>
export type PasskeyTestPredicate = (row: PasskeyTestRow) => boolean
export type PasskeyTestTable =
    | 'users'
    | 'sessions'
    | 'factors'
    | 'challenges'
    | 'credentials'
    | 'auditLogs'
export type PasskeyTestRows = Record<PasskeyTestTable, Array<PasskeyTestRow>>
export type PasskeyTestContext = {
    rows: PasskeyTestRows | null
    release: (() => void) | null
}
export type PasskeyTestApi = ReturnType<typeof createPasskeyTestApi>
export type PasskeyTestOperation<Result> = (
    transaction: PasskeyTestApi,
) => Promise<Result>
export type PasskeyTestState = {
    rows: PasskeyTestRows
    insertValues: Array<PasskeyTestRow>
    events: Array<string>
    beforeUserLock: (() => void) | null
    failInsertTable: PasskeyTestTable | null
    failDeleteTable: PasskeyTestTable | null
}
