type AuditLogJsonValue =
    | string
    | number
    | boolean
    | null
    | Array<AuditLogJsonValue>
    | { [key: string]: AuditLogJsonValue }

export type AuditLogJsonRecord = Record<string, AuditLogJsonValue>

export type AuditLogEntry = {
    id: string
    action: string
    actorUserId: string | null
    actorUsername: string | null
    message: string | null
    route: string | null
    method: string | null
    oldValues: AuditLogJsonRecord | null
    newValues: AuditLogJsonRecord | null
    createdAt: string
}
