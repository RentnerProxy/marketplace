import { deleteCookie, getCookie } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, users } from '@/db/schema.ts'
import { SESSION_COOKIE_NAME } from '@/config/session.config.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { publishSessionRevokedService } from '@/server/Realtime/publish.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { getSessionTokenCandidateService } from './session-token.service.ts'

function completeLogout() {
    deleteCookie(SESSION_COOKIE_NAME, { path: '/' })
    return { success: true as const }
}

export async function logoutService() {
    const candidate = await getSessionTokenCandidateService(
        getCookie(SESSION_COOKIE_NAME),
    )
    if (!candidate) return completeLogout()
    const { sessionHash } = candidate
    const sessionRows = await db
        .select({ userId: sessions.userId })
        .from(sessions)
        .where(eq(sessions.id, sessionHash))
        .limit(1)
    const actorUserId = sessionRows.at(0)?.userId
    if (!actorUserId) return completeLogout()

    const auditContext = prepareAuditContextService(actorUserId)
    const result = await db.transaction(async function (transaction) {
        const lockedUsers = await transaction
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, actorUserId))
            .limit(1)
            .for('update')
        const lockedActorUserId = lockedUsers.at(0)?.id
        if (!lockedActorUserId) return null

        const deletedSessions = await transaction
            .delete(sessions)
            .where(
                and(
                    eq(sessions.id, sessionHash),
                    eq(sessions.userId, lockedActorUserId),
                ),
            )
            .returning({ id: sessions.id })
        if (deletedSessions.length === 0) return null

        const auditReceipt = await writeAuditLogInTransactionService(
            transaction,
            {
                ...auditContext,
                actorUserId: lockedActorUserId,
                action: 'auth.logout',
                message: 'Benutzer hat sich abgemeldet.',
            },
        )
        return { actorUserId: lockedActorUserId, auditReceipt }
    })

    if (!result) return completeLogout()
    await publishCommittedAuditLogService(result.auditReceipt)
    try {
        await publishSessionRevokedService({
            userId: result.actorUserId,
            sessionHash,
            revokedAt: new Date().toISOString(),
        })
    } catch (error) {
        logError('auth.logout.realtime_revoke_failed', error, {
            userId: result.actorUserId,
        })
    }

    return completeLogout()
}
