import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { and, eq, ne } from 'drizzle-orm'
import { users } from '@/db/schema.ts'

export async function hasOtherVisibleUserInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
) {
    const otherUsers = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(ne(users.id, userId), eq(users.isDeleted, false)))
        .limit(1)

    return otherUsers.length > 0
}
