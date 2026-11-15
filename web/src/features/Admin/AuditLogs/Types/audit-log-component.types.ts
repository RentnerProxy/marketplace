import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'

type AuditLogsState = {
    auditLogs: Array<AuditLogEntry>
    isLoadingAuditLogs: boolean
}

export type AuditLogsLogicReturn = {
    state: AuditLogsState
}
