import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'

export type AuditTableProps = {
    auditLogs: Array<AuditLogEntry>
    isLoadingAuditLogs: boolean
}

export type AuditLogDetailsProps = {
    auditLog: AuditLogEntry
}

export type AuditLogDetailsLogicReturn = {
    state: {
        rows: Array<{ key: string; oldValue: string; newValue: string }>
    }
}
