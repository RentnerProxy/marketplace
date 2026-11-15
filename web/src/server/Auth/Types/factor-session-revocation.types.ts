import type { AuditReceipt } from '@/lib/AuditLogs/Types/audit.types.ts'

export type CommittedFactorSessionRevocationInput = {
    userId: string
    auditReceipt: AuditReceipt
}
