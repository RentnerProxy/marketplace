import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { systemSettings } from '@/db/Schema/systemSettings.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { SYSTEM_SETTINGS_ID } from '@/server/Admin/SystemSettings/settings.service.ts'
import { lockAccountUniquenessInTransactionService } from '@/server/Auth/accountUniqueness.service.ts'

export const disabledRegistrationResult = {
    success: false,
    error: 'registration.disabled',
} as const

export async function isPublicRegistrationEnabledService(
    transaction?: DatabaseTransaction,
) {
    const selection = (transaction ?? db)
        .select({ enabled: systemSettings.isPublicRegistrationEnabled })
        .from(systemSettings)
        .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
        .limit(1)
    // The settings writer locks the same row for update. Hold the shared lock
    // through the account or pending registration write.
    const [settings] = await (transaction ? selection.for('share') : selection)
    return settings?.enabled ?? false
}

export async function withPublicRegistrationTransactionService<T>(
    run: (transaction: DatabaseTransaction) => Promise<T>,
) {
    return db.transaction(async (transaction) => {
        await lockAccountUniquenessInTransactionService(transaction)
        if (!(await isPublicRegistrationEnabledService(transaction)))
            return 'disabled' as const
        return run(transaction)
    })
}
