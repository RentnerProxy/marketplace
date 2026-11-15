export type SystemSettingsTestEffect = {
    kind: string
    activeTransaction: number
    actorLocked: boolean
    committedAuditActions: string[]
}

export type SystemSettingsRevocation = 'permission' | 'inactive' | 'deleted'

export type SystemSettingsTestHandlerContext = {
    data: unknown
}
