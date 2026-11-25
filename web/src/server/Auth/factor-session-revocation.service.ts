import { runBestEffortSideEffectService } from '@/server/Logging/side-effect.service.ts'
import { publishUserSessionsRevokedService } from '@/server/Realtime/publish.service.ts'
import type { CommittedFactorSessionRevocationInput } from './Types/factor-session-revocation.types.ts'

export async function publishCommittedFactorSessionRevocationService(
    input: CommittedFactorSessionRevocationInput,
): Promise<void> {
    await runBestEffortSideEffectService(
        'auth.factor_change.realtime_revoke_failed',
        function () {
            return publishUserSessionsRevokedService({
                userId: input.userId,
                revokedAt: input.auditReceipt.createdAt.toISOString(),
            })
        },
        { auditLogId: input.auditReceipt.id },
    ).catch(() => undefined)
}
