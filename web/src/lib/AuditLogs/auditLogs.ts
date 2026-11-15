import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { getRequestHeader } from '@tanstack/react-start/server'
import { db } from '@/db'
import { auditLogs } from '@/db/schema.ts'
import { AUDIT_FIELD_LIMITS } from '@/config/audit.config.ts'
import { truncateNullableText } from '@/lib/String/string.ts'
import { publishAuditLogCreatedService } from '@/server/Realtime/publish.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { sanitizeAuditRoute } from './auditRoute.ts'
import { lockAuditUsersInTransactionService } from './user-locks.ts'
import { prunePreferenceAuditLogsInTransactionService } from './preference-retention.ts'
import type {
    AuditReceipt,
    AuditRequestMetadata,
    PreparedAuditContext,
    WriteAuditLogInput,
} from './Types/audit.types.ts'

function getRequestRoute() {
    try {
        return sanitizeAuditRoute(getRequestHeader('referer'))
    } catch {
        return null
    }
}

export function prepareAuditContextService(
    actorUserId: string | null,
    metadata: AuditRequestMetadata = {},
): PreparedAuditContext {
    if (actorUserId === undefined) {
        throw new Error('An explicit audit actor is required')
    }

    return {
        actorUserId,
        route: truncateNullableText(
            metadata.route === undefined
                ? getRequestRoute()
                : sanitizeAuditRoute(metadata.route),
            AUDIT_FIELD_LIMITS.route,
        ),
        method: truncateNullableText(
            metadata.method ?? 'POST',
            AUDIT_FIELD_LIMITS.method,
        ),
    }
}

export async function writeAuditLogInTransactionService(
    transaction: DatabaseTransaction,
    input: WriteAuditLogInput,
): Promise<AuditReceipt> {
    if (input.actorUserId === undefined || !input.action.trim()) {
        throw new Error('An explicit audit actor and action are required')
    }

    const insertedRows = await transaction
        .insert(auditLogs)
        .values({
            action: input.action.slice(0, AUDIT_FIELD_LIMITS.action),
            actorUserId: input.actorUserId,
            message: truncateNullableText(
                input.message,
                AUDIT_FIELD_LIMITS.message,
            ),
            route: truncateNullableText(
                sanitizeAuditRoute(input.route),
                AUDIT_FIELD_LIMITS.route,
            ),
            method: truncateNullableText(
                input.method,
                AUDIT_FIELD_LIMITS.method,
            ),
            oldValues: input.oldValues ?? null,
            newValues: input.newValues ?? null,
        })
        .returning({ id: auditLogs.id, createdAt: auditLogs.createdAt })

    const receipt = insertedRows.at(0)
    if (
        insertedRows.length !== 1 ||
        !receipt ||
        typeof receipt.id !== 'string' ||
        !receipt.id ||
        !(receipt.createdAt instanceof Date) ||
        !Number.isFinite(receipt.createdAt.getTime())
    ) {
        throw new Error('Audit insert did not return its persisted receipt')
    }

    await prunePreferenceAuditLogsInTransactionService(
        transaction,
        input.actorUserId,
        input.action,
        receipt,
    )

    return receipt
}

export async function publishCommittedAuditLogService(
    receipt: AuditReceipt,
): Promise<void> {
    try {
        await publishAuditLogCreatedService({
            auditLogId: receipt.id,
            createdAt: receipt.createdAt.toISOString(),
        })
    } catch (error) {
        logError('audit.publish_failed', error, { auditLogId: receipt.id })
    }
}

export async function writeStandaloneAuditLogService(
    input: WriteAuditLogInput,
): Promise<void> {
    const receipt = await db.transaction(async function (transaction) {
        await lockAuditUsersInTransactionService(transaction, [
            input.actorUserId,
        ])
        return writeAuditLogInTransactionService(transaction, input)
    })
    await publishCommittedAuditLogService(receipt)
}
