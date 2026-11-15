import { db } from '@/db'
import { prepareAuditContextService } from '@/lib/AuditLogs/auditLogs.ts'
import type { UpdateUserProfileInput } from '@/features/Admin/UserManagement/Types/user-management-server-input.types.ts'
import { getCurrentSessionUserId } from '@/server/Auth/currentSession.ts'
import { completeUserUpdateService } from './updateCompletion.service.ts'
import { normalizeUserProfileUpdate } from './updateInput.service.ts'
import { updateUserInTransaction } from './updateTransaction.service.ts'

export async function updateUserProfileService(data: UpdateUserProfileInput) {
    const normalizedUpdate = normalizeUserProfileUpdate(data)
    if (!normalizedUpdate.success) {
        return normalizedUpdate
    }

    const currentUserId = await getCurrentSessionUserId()
    const auditContext = prepareAuditContextService(currentUserId)
    const transactionResult = await db.transaction(
        async function (transaction) {
            return updateUserInTransaction(
                transaction,
                normalizedUpdate.input,
                auditContext,
            )
        },
    )

    if (!transactionResult.success) {
        return transactionResult
    }

    const user = await completeUserUpdateService(
        transactionResult,
        currentUserId,
    )

    return { success: true as const, user }
}
