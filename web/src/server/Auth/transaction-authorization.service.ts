import { eq } from 'drizzle-orm'
import { users } from '@/db/schema.ts'
import { lockAuditUsersInTransactionService } from '@/lib/AuditLogs/user-locks.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import type { PermissionKey } from '@/shared/Types/config.types.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { PermissionDeniedError } from './authorization.errors.ts'

export async function getActiveUserPermissionKeysInTransaction(
    transaction: DatabaseTransaction,
    userId: string | null,
): Promise<Array<string> | null> {
    if (!userId) return null
    const userRows = await transaction
        .select({
            isActive: users.isActive,
            isDeleted: users.isDeleted,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    const user = userRows.at(0)
    if (!user || !user.isActive || user.isDeleted) return null
    return getUserPermissionKeys(userId, transaction)
}

export async function requireMutationPermissionService(
    transaction: DatabaseTransaction,
    actorUserId: string,
    permission: PermissionKey,
): Promise<void> {
    await lockAuditUsersInTransactionService(transaction, [actorUserId])
    const permissionKeys = await getActiveUserPermissionKeysInTransaction(
        transaction,
        actorUserId,
    )
    if (!permissionKeys || !hasPermission(permissionKeys, permission)) {
        throw new PermissionDeniedError()
    }
}
