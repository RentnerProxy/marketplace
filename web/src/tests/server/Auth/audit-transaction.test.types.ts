export type AuthAuditTestTable =
    | 'users'
    | 'sessions'
    | 'passwordResetTokens'
    | 'auditLogs'
    | 'systemSettings'
    | 'user_profiles'
    | 'staffUserPermissions'
    | 'staffAccounts'
    | 'defaultUserPermissions'
    | 'permissions'
export type AuthAuditTestRow = Record<string, unknown>
export type AuthAuditTestRows = Record<
    AuthAuditTestTable,
    Array<AuthAuditTestRow>
>
export type AuthAuditTestPredicate = (row: AuthAuditTestRow) => boolean
export type AuthAuditTestContext = {
    rows: AuthAuditTestRows
    userLocked: boolean
    id: number
}
export type AuthAuditTestState = {
    rows: AuthAuditTestRows
    events: Array<string>
    nextTransaction: number
    failAuditAt: number | null
    auditAttempts: number
    failCommitAt: number | null
}
