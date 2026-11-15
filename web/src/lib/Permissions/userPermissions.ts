import type { DatabaseReader } from '@/lib/Database/Types/database.types.ts'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { permissions, userPermissions } from '@/db/schema.ts'

export async function getUserPermissionKeys(
    userId: string,
    database: DatabaseReader = db,
) {
    const permissionRows = await database
        .select({ key: permissions.key })
        .from(userPermissions)
        .innerJoin(
            permissions,
            eq(permissions.id, userPermissions.permissionId),
        )
        .where(eq(userPermissions.userId, userId))

    return permissionRows.map((permission) => permission.key)
}
