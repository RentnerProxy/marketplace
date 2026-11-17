import { and, gt, or, sql } from 'drizzle-orm'
import { staffInvitations } from '@/db/Schema/accounts.ts'
import { users } from '@/db/Schema/users.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'

export async function lockAccountUniquenessInTransactionService(
    transaction: DatabaseTransaction,
) {
    // Acquire before user row locks so every identity writer uses the same order.
    await transaction.execute(sql`select pg_advisory_xact_lock(7421906)`)
}

export function accountIdentityMatchesService(input: {
    username: string
    email: string
}) {
    return or(
        sql`lower(${users.username}) = ${input.username.toLowerCase()}`,
        sql`lower(${users.email}) = ${input.email.toLowerCase()}`,
    )
}

export async function hasStaffIdentityReservationInTransactionService(
    transaction: DatabaseTransaction,
    input: { username: string; email: string },
    now = new Date(),
) {
    const reserved = await transaction
        .select({ id: staffInvitations.id })
        .from(staffInvitations)
        .where(
            and(
                gt(staffInvitations.expiresAt, now),
                or(
                    sql`lower(${staffInvitations.username}) = ${input.username.toLowerCase()}`,
                    sql`lower(${staffInvitations.email}) = ${input.email.toLowerCase()}`,
                ),
            ),
        )
        .limit(1)
    return reserved.length > 0
}
