import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { auditLogs, users } from '@/db/schema.ts'
import type {
    AuditLogJsonRecord,
    AuditLogJsonValue,
} from '@/lib/AuditLogs/Types/auditLog.types.ts'

function getSerializableAuditValues(
    values: unknown,
): AuditLogJsonRecord | null {
    if (values === null) return null
    if (
        typeof values !== 'object' ||
        Array.isArray(values) ||
        !isPlainAuditRecord(values)
    ) {
        throw new Error('Invalid stored audit values')
    }
    return normalizeAuditRecord(values)
}

function isPlainAuditRecord(value: object): value is Record<string, unknown> {
    const prototype: unknown = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function normalizeAuditRecord(
    values: Record<string, unknown>,
): AuditLogJsonRecord {
    const result: AuditLogJsonRecord = {}
    for (const key of Object.keys(values)) {
        if (key === '__proto__') continue
        const property = Object.getOwnPropertyDescriptor(values, key)
        if (!property || !('value' in property)) {
            throw new Error('Invalid stored audit value')
        }
        const value = normalizeAuditValue(property.value)
        if (value !== undefined) result[key] = value
    }
    return result
}

function normalizeAuditValue(value: unknown): AuditLogJsonValue | undefined {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean'
    )
        return value
    if (typeof value === 'number')
        return Number.isFinite(value) ? value + 0 : null
    if (typeof value === 'bigint') throw new Error('Invalid stored audit value')
    if (typeof value !== 'object') return undefined
    if (Array.isArray(value))
        return Array.from(
            value,
            (item: unknown) => normalizeAuditValue(item) ?? null,
        )
    if (value instanceof Date) {
        return Number.isFinite(Date.prototype.getTime.call(value))
            ? Date.prototype.toISOString.call(value)
            : null
    }
    if (!isPlainAuditRecord(value))
        throw new Error('Invalid stored audit value')
    return normalizeAuditRecord(value)
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
