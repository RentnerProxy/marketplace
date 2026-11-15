export type AuditRequestMetadata = {
    route?: string | null
    method?: string | null
}

export type PreparedAuditContext = {
    actorUserId: string | null
    route: string | null
    method: string | null
}

export type WriteAuditLogInput = PreparedAuditContext & {
    action: string
    message?: string | null
    oldValues?: Record<string, unknown> | null
    newValues?: Record<string, unknown> | null
}

export type AuditReceipt = {
    id: string
    createdAt: Date
}
