import { logError } from '@/server/Logging/logger.ts'
import { publishUserSessionsRevokedService } from '@/server/Realtime/publish.service.ts'
import type { CommittedFactorSessionRevocationInput } from './Types/factor-session-revocation.types.ts'

export async function publishCommittedFactorSessionRevocationService(
    input: CommittedFactorSessionRevocationInput,
): Promise<void> {
    try {
        await publishUserSessionsRevokedService({
            userId: input.userId,
            revokedAt: input.auditReceipt.createdAt.toISOString(),
        })
    } catch (error) {
        try {
            logError('auth.factor_change.realtime_revoke_failed', error, {
                auditLogId: input.auditReceipt.id,
            })
        } catch {}
    }
}
