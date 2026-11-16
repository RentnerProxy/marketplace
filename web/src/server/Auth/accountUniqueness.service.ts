import { or, sql } from 'drizzle-orm'
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
