import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { eq } from 'drizzle-orm'
import { users } from '@/db/schema.ts'
export async function lockAuditUsersInTransactionService(
    transaction: DatabaseTransaction,
    userIds: Array<string | null>,
): Promise<void> {
    const orderedIds = [
        ...new Set(
            userIds
                .filter((id): id is string => id !== null)
                .map((id) => id.toLowerCase()),
        ),
    ].toSorted()
    await forEachSequentially(orderedIds, async function (userId) {
        await transaction
            .select({
                id: users.id,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
            .for('update')
    })
}
