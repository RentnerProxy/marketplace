import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
    permissions,
    sessions,
    accountPermissions,
    users,
} from '@/db/schema.ts'
import type { RealtimeSessionSnapshot } from '@/websockets/Types/realtime-validation.types.ts'

export async function readRealtimeSessionSnapshots(
    deadlines: Map<string, number>,
) {
    const snapshots = new Map<string, RealtimeSessionSnapshot>()
    if (deadlines.size === 0) return snapshots

    const sessionRows = await db
        .select({
            sessionHash: sessions.id,
            userId: users.id,
            username: users.username,
            isActive: users.isActive,
            isDeleted: users.isDeleted,
            expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(inArray(sessions.id, [...deadlines.keys()]))

    const now = Date.now()
    const permissionsByUser = new Map<string, Array<string>>()
    for (const row of sessionRows) {
        const expiresAtMs = row.expiresAt.getTime()
        if (
            !row.isActive ||
            row.isDeleted ||
            !(Math.min(expiresAtMs, deadlines.get(row.sessionHash) ?? 0) > now)
        )
            continue

        const permissionKeys = permissionsByUser.get(row.userId) ?? []
        permissionsByUser.set(row.userId, permissionKeys)
        snapshots.set(row.sessionHash, {
            userId: row.userId,
            username: row.username,
            expiresAtMs,
            permissions: permissionKeys,
        })
    }
    if (permissionsByUser.size === 0) return snapshots

    const permissionRows = await db
        .select({ userId: accountPermissions.userId, key: permissions.key })
        .from(accountPermissions)
        .innerJoin(
            permissions,
            eq(permissions.id, accountPermissions.permissionId),
        )
        .where(
            inArray(accountPermissions.userId, [...permissionsByUser.keys()]),
        )

    for (const { userId, key } of permissionRows) {
        permissionsByUser.get(userId)?.push(key)
    }
    return snapshots
}
