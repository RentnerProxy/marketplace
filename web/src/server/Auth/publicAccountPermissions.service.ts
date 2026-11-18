import { inArray } from 'drizzle-orm'
import { DEFAULT_PUBLIC_PERMISSION_KEYS } from '@/config/permissions.config.ts'
import { permissions } from '@/db/Schema/permissions.ts'
import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'

export async function getDefaultPublicPermissionsInTransactionService(
    transaction: DatabaseTransaction,
) {
    const defaults = await transaction
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.key, DEFAULT_PUBLIC_PERMISSION_KEYS))
        .for('share')

    if (defaults.length !== DEFAULT_PUBLIC_PERMISSION_KEYS.length) {
        throw new Error(
            'The configured public account permissions are unavailable',
        )
    }

    return defaults
}
