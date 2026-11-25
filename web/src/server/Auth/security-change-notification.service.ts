import { enqueueSecurityChangeMail } from '@/server/Queues/mail.queue.ts'
import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'
import type { CommittedSecurityChangeNotificationInput } from './Types/security-change-notification.types.ts'

export async function notifyCommittedSecurityChangeService(
    input: CommittedSecurityChangeNotificationInput,
): Promise<void> {
    await runBestEffortSideEffectService(
        'auth.security_change_notification.failed',
        function () {
            return enqueueSecurityChangeMail({
                to: input.to,
                change: input.change,
                changedAt: input.auditReceipt.createdAt.toISOString(),
                auditEventId: input.auditReceipt.id,
            })
        },
        { auditLogId: input.auditReceipt.id },
    ).catch(() => undefined)
}
