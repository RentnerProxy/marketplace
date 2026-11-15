export type StorageMutationSqlTestSession = {
    id: number
    active: boolean
    shared: boolean
    exclusive: boolean
    released: boolean
    closed: boolean
}

export type StorageMutationSqlTestRow =
    { acquired: boolean } | { unlocked: boolean }

type StorageMutationSqlTestWaiter = {
    session: StorageMutationSqlTestSession
    resolve: () => void
    reject: (error: unknown) => void
}

export type StorageMutationSqlTestModel = {
    rootDirectory: string
    healthy: boolean
    restoreActive: boolean
    sessions: StorageMutationSqlTestSession[]
    waiters: StorageMutationSqlTestWaiter[]
    reserveHook:
        ((session: StorageMutationSqlTestSession) => Promise<void>) | null
    exclusiveHook:
        ((session: StorageMutationSqlTestSession) => Promise<void>) | null
    closeHook:
        ((session: StorageMutationSqlTestSession) => Promise<void>) | null
}
