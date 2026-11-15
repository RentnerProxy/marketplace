import type { AuditReceipt } from '@/lib/AuditLogs/Types/audit.types.ts'
import type { SecurityChangeMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'

export type CommittedSecurityChangeNotificationInput = Pick<
    SecurityChangeMailInput,
    'to' | 'change'
> & {
    auditReceipt: AuditReceipt
}
