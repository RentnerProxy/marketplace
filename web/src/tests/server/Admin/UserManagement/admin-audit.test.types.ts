export type AdminTestRow = Record<string, unknown>
export type AdminTestTable = Record<string, string>
export type AdminTestSelection = Record<string, unknown>
export type AdminTestCondition = {
    kind: 'and' | 'or' | 'eq' | 'ne' | 'inArray' | 'lowerEq'
    values: unknown[]
}
export type AdminTestContext = Record<string, AdminTestRow>
export type AdminTestQuery = PromiseLike<AdminTestRow[]> & {
    from(table: AdminTestTable): AdminTestQuery
    where(condition: AdminTestCondition): AdminTestQuery
    innerJoin(
        table: AdminTestTable,
        condition: AdminTestCondition,
    ): AdminTestQuery
    limit(count: number): AdminTestQuery
    orderBy(...columns: unknown[]): AdminTestQuery
    for(mode: string): Promise<AdminTestRow[]>
    values(values: AdminTestRow | AdminTestRow[]): AdminTestQuery
    set(values: AdminTestRow): AdminTestQuery
    onConflictDoNothing(options?: { target?: string }): AdminTestQuery
    onConflictDoUpdate(options: {
        target: string
        set: AdminTestRow
    }): AdminTestQuery
    returning(selection?: AdminTestSelection): Promise<AdminTestRow[]>
}
export type AdminTestEvent = {
    transaction: number
    operation: string
    table?: string
    ids?: unknown[]
    values?: AdminTestRow | AdminTestRow[]
}
