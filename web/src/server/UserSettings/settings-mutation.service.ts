import { db } from '@/db'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import type {
    UserSettingsAuditEvent,
    UserSettingsMutation,
} from './Types/settings-audit.types.ts'

export async function runAuditedUserSettingsMutationService<T>(
    userId: string,
    event: UserSettingsAuditEvent,
    mutation: UserSettingsMutation<T>,
): Promise<T> {
    const context = prepareAuditContextService(userId)
    const committed = await db.transaction(async function (transaction) {
        await lockAuditUsersInTransactionService(transaction, [userId])
        const changed = await mutation(transaction)
        if (!changed.changed)
            return { value: changed.value, auditReceipt: null }
        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...context,
                ...event,
                oldValues: changed.oldValues,
                newValues: changed.newValues,
            },
        )
        return { value: changed.value, auditReceipt }
    })
    if (committed.auditReceipt) {
        await publishCommittedAuditLogService(committed.auditReceipt)
    }
    return committed.value
}
