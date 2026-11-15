export type TransactionAuthorizationTestCondition = {
    column: unknown
    value: unknown
}

export type TransactionAuthorizationTestState = {
    userId: string
    present: boolean
    isActive: boolean
    isDeleted: boolean
    permissionKeys: Array<string>
    events: Array<string>
    beforeLock: () => Promise<void>
}
