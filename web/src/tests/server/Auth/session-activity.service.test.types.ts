export type ActivityTestRow = Record<string, unknown>
export type ActivityTestTable = 'users' | 'sessions'
export type ActivityTestColumn = {
    table: ActivityTestTable
    field: string
}
export type ActivityTestSql =
    { kind: 'clock' } | { kind: 'absolute-live'; value: unknown }
export type ActivityTestPredicate =
    | { kind: 'eq' | 'gt'; column: ActivityTestColumn; value: unknown }
    | { kind: 'and'; conditions: Array<ActivityTestPredicate> }
    | ActivityTestSql
export type ActivityTestTables = Record<
    ActivityTestTable,
    Array<ActivityTestRow>
>
export type ActivityTestTransaction = {
    rows: ActivityTestTables | null
    userLocked: boolean
    sessionLocked: boolean
    release: (() => void) | null
}
