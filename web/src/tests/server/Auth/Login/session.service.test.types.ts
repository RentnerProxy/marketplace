export type SessionTestRow = Record<string, unknown>
export type SessionTestTable =
    | 'users'
    | 'passkeyCredentials'
    | 'socialAccounts'
    | 'sessions'
    | 'trustedDevices'
    | 'userPermissions'
    | 'permissions'
    | 'twoFactorAuth'
    | 'auditLogs'
export type SessionTestTables = Record<SessionTestTable, Array<SessionTestRow>>
export type SessionTestScope = Partial<Record<SessionTestTable, SessionTestRow>>
export type SessionTestColumn = { table: SessionTestTable; field: string }
export type SessionTestPredicate =
    | { kind: 'eq'; column: SessionTestColumn; value: unknown }
    | { kind: 'and'; conditions: Array<SessionTestPredicate> }
export type SessionTestTransaction = {
    id: number
    rows: SessionTestTables
    userLocked: boolean
    releaseLock: (() => void) | null
}
export type SessionTestState = {
    rows: SessionTestTables
    events: Array<string>
    generatedTokens: Array<string>
    nextTransactionId: number
    userLockConditions: Array<SessionTestPredicate>
    passkeyConditions: Array<SessionTestPredicate>
    deleteConditions: Array<{
        table: SessionTestTable
        predicate: SessionTestPredicate
    }>
    insertedRows: Array<{ table: SessionTestTable; values: SessionTestRow }>
    failInsertTable: SessionTestTable | null
    failCookieName: string | null
    maintenanceActive: boolean
    afterUserLock: (() => Promise<void>) | null
    beforeMeta: (() => Promise<void>) | null
    beforePermissions: (() => Promise<void>) | null
    cookies: Map<string, string>
}
