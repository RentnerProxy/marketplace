import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { auditLogs, users } from '@/db/schema.ts'
import type { AuditLogJsonRecord } from '@/lib/AuditLogs/Types/auditLog.types.ts'
import { z } from 'zod'

const auditValuesSchema = z.record(z.string(), z.json())

function getSerializableAuditValues(
    values: Record<string, unknown> | null,
): AuditLogJsonRecord | null {
    if (!values) {
        return null
    }

    return auditValuesSchema.parse(JSON.parse(JSON.stringify(values)))
}

export async function getAuditLogsService() {
    const result = await db
        .select({
            id: auditLogs.id,
            action: auditLogs.action,
            actorUserId: auditLogs.actorUserId,
            actorUsername: users.username,
            message: auditLogs.message,
            route: auditLogs.route,
            method: auditLogs.method,
            oldValues: auditLogs.oldValues,
            newValues: auditLogs.newValues,
            createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(500)

    return result.map(function (auditLog) {
        const { createdAt, newValues, oldValues } = auditLog

        return {
            id: auditLog.id,
            action: auditLog.action,
            actorUserId: auditLog.actorUserId,
            actorUsername: auditLog.actorUsername,
            message: auditLog.message,
            route: auditLog.route,
            method: auditLog.method,
            oldValues: getSerializableAuditValues(oldValues),
            newValues: getSerializableAuditValues(newValues),
            createdAt: createdAt.toISOString(),
        }
    })
}
