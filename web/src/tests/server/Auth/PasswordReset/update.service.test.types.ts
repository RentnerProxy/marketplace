export type PasswordResetTestTable =
    | 'users'
    | 'passwordResetTokens'
    | 'sessions'
    | 'trustedDevices'
    | 'auditLogs'

export type PasswordResetTestRow = Record<string, unknown>

export type PasswordResetTestTables = Record<
    PasswordResetTestTable,
    Array<PasswordResetTestRow>
>

export type PasswordResetTestPredicate =
    | { kind: 'and'; conditions: Array<PasswordResetTestPredicate> }
    | { kind: 'eq'; column: string; value: unknown }
    | { kind: 'gt'; column: string; value: Date }

export type PasswordResetTestFailure =
    | 'password-update'
    | 'empty-password-update'
    | 'sessions-delete'
    | 'trustedDevices-delete'
    | 'commit'
    | 'audit'

export type PasswordResetTestState = {
    tables: PasswordResetTestTables
    events: Array<string>
    beforePasswordHash: (() => Promise<void>) | null
    onLockRequested: (() => void) | null
    failAt: PasswordResetTestFailure | null
    transactionCount: number
}
