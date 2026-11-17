import type { DatabaseReader } from '@/lib/Database/Types/database.types.ts'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { permissions, accountPermissions } from '@/db/schema.ts'

export async function getUserPermissionKeys(
    userId: string,
    database: DatabaseReader = db,
) {
    const permissionRows = await database
        .select({ key: permissions.key })
        .from(accountPermissions)
        .innerJoin(
            permissions,
            eq(permissions.id, accountPermissions.permissionId),
        )
        .where(eq(accountPermissions.userId, userId))

    return permissionRows.map((permission) => permission.key)
}
