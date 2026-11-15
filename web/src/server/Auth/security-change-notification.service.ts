import { enqueueSecurityChangeMail } from '@/server/Queues/mail.queue.ts'
import { logError } from '@/server/Logging/logger.ts'
import type { CommittedSecurityChangeNotificationInput } from './Types/security-change-notification.types.ts'

export async function notifyCommittedSecurityChangeService(
    input: CommittedSecurityChangeNotificationInput,
): Promise<void> {
    try {
        await enqueueSecurityChangeMail({
            to: input.to,
            change: input.change,
            changedAt: input.auditReceipt.createdAt.toISOString(),
            auditEventId: input.auditReceipt.id,
        })
    } catch (error) {
        try {
            logError('auth.security_change_notification.failed', error, {
                auditLogId: input.auditReceipt.id,
            })
        } catch {}
    }
}
