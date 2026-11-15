import type {
    AuditReceipt,
    WriteAuditLogInput,
} from '@/lib/AuditLogs/Types/audit.types.ts'

export type AuditModelRow = Record<string, unknown>
export type AuditModelFields = Record<string, string>
export type AuditModelAuditRow = WriteAuditLogInput & AuditReceipt
export type AuditModelPredicate =
    | { kind: 'eq' | 'ne'; column: string; value: unknown }
    | { kind: 'in'; column: string; values: Array<unknown> }
    | { kind: 'and'; conditions: Array<AuditModelPredicate> }
export type AuditModelOrder = { column: string; direction: 'asc' }
export type AuditModelState = {
    rows: Map<string, AuditModelRow>
    audits: Array<AuditModelAuditRow>
    events: Array<string>
    active: boolean
    lockedUsers: Set<string>
    nextAuditId: number
    auditCreatedAt: Date
    retentionReadLimits: Array<number>
    deletedAuditIds: Array<string>
    failPrune: boolean
    failAction: string | null
    failCommit: boolean
    failPublish: boolean
    emptyReturning: boolean
    auditReceipts: Array<AuditModelRow> | null
}
