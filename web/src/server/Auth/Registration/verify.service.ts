import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { pendingRegistrations } from '@/db/Schema/registration.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { publishCommittedAuditLogService } from '@/lib/AuditLogs/auditLogs.ts'
import type {
    VerifyRegistrationInput,
    VerifyRegistrationResult,
} from '@/features/Auth/Register/Types/registration.types.ts'
import { createPublicAccountInTransactionService } from './account.service.ts'

export async function verifyRegistrationService(
    data: VerifyRegistrationInput,
): Promise<VerifyRegistrationResult> {
    const tokenHash = await createTokenHash(data.token)
    const created = await db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(7421906)`)
        const rows = await transaction
            .delete(pendingRegistrations)
            .where(eq(pendingRegistrations.tokenHash, tokenHash))
            .returning()
        const pending = rows.at(0)
        if (!pending || pending.expiresAt.getTime() <= Date.now()) return null
        return createPublicAccountInTransactionService(transaction, {
            username: pending.username,
            email: pending.email,
            passwordHash: pending.passwordHash,
            termsVersion: pending.termsVersion,
            acceptedAt: pending.acceptedAt,
            ...(pending.provider && pending.subject
                ? { provider: pending.provider, subject: pending.subject }
                : {}),
        })
    })
    if (!created)
        return { success: false, error: 'registration.invalidVerification' }
    await publishCommittedAuditLogService(created.auditReceipt)
    return { success: true }
}
