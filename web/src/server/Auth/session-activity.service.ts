import { getCookie } from '@tanstack/react-start/server'
import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, users } from '@/db/schema.ts'
import { SESSION_COOKIE_NAME, sessionConfig } from '@/config/session.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { getSessionTokenCandidateService } from './session-token.service.ts'
import type { SessionActivityResult } from './Types/session-activity.types.ts'

export async function touchCurrentSessionActivityService(): Promise<SessionActivityResult> {
    await enforceRateLimit({
        ...RATE_LIMITS.sessionActivityIp,
        scope: 'session-activity-ip',
    })
    const candidate = await getSessionTokenCandidateService(
        getCookie(SESSION_COOKIE_NAME),
    )
    if (!candidate) return { active: false }

    const identities = await db
        .select({ userId: sessions.userId })
        .from(sessions)
        .where(eq(sessions.id, candidate.sessionHash))
        .limit(1)
    const identity = identities.at(0)
    if (!identity || candidate.absoluteExpiresAt.getTime() <= Date.now()) {
        return { active: false }
    }

    await enforceRateLimit({
        ...RATE_LIMITS.sessionActivitySession,
        scope: 'session-activity-session',
        identifiers: [candidate.sessionHash],
        includeClientIp: false,
    })
    if (candidate.absoluteExpiresAt.getTime() <= Date.now()) {
        return { active: false }
    }

    const result = await db.transaction(async function (transaction) {
        const lockedUsers = await transaction
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.id, identity.userId),
                    eq(users.isActive, true),
                    eq(users.isDeleted, false),
                ),
            )
            .limit(1)
            .for('update')
        const currentUser = lockedUsers.at(0)
        if (!currentUser) return { active: false as const }

        const lockedSessions = await transaction
            .select({
                id: sessions.id,
                userId: sessions.userId,
                expiresAt: sessions.expiresAt,
            })
            .from(sessions)
            .where(
                and(
                    eq(sessions.id, candidate.sessionHash),
                    eq(sessions.userId, currentUser.id),
                ),
            )
            .limit(1)
            .for('update')
        const session = lockedSessions.at(0)
        const nowMs = Date.now()
        const absoluteExpiresAtMs = candidate.absoluteExpiresAt.getTime()
        if (
            !session ||
            session.id !== candidate.sessionHash ||
            session.userId !== currentUser.id ||
            !(session.expiresAt.getTime() > nowMs) ||
            absoluteExpiresAtMs <= nowMs
        ) {
            return { active: false as const }
        }

        const currentExpiresAtMs = Math.min(
            session.expiresAt.getTime(),
            absoluteExpiresAtMs,
        )
        const nextExpiresAtMs = Math.min(
            nowMs + sessionConfig.idleDurationMs,
            absoluteExpiresAtMs,
        )
        if (
            nextExpiresAtMs <= currentExpiresAtMs ||
            nowMs <
                session.expiresAt.getTime() -
                    sessionConfig.idleDurationMs +
                    sessionConfig.activityThrottleMs
        ) {
            return {
                active: true as const,
                expiresAt: new Date(currentExpiresAtMs).toISOString(),
            }
        }

        const nextExpiresAt = new Date(nextExpiresAtMs)
        const updatedSessions = await transaction
            .update(sessions)
            .set({ expiresAt: nextExpiresAt })
            .where(
                and(
                    eq(sessions.id, candidate.sessionHash),
                    eq(sessions.userId, currentUser.id),
                    eq(sessions.expiresAt, session.expiresAt),

                    gt(sessions.expiresAt, sql<Date>`clock_timestamp()`),
                    sql`${candidate.absoluteExpiresAt.toISOString()}::timestamptz > clock_timestamp()`,
                ),
            )
            .returning({ expiresAt: sessions.expiresAt })
        const updatedSession = updatedSessions.at(0)
        if (
            updatedSessions.length !== 1 ||
            !updatedSession ||
            !(
                Math.min(
                    updatedSession.expiresAt.getTime(),
                    absoluteExpiresAtMs,
                ) > Date.now()
            )
        ) {
            return { active: false as const }
        }
        return {
            active: true as const,
            expiresAt: new Date(
                Math.min(
                    updatedSession.expiresAt.getTime(),
                    absoluteExpiresAtMs,
                ),
            ).toISOString(),
        }
    })
    if (result.active && !(Date.parse(result.expiresAt) > Date.now())) {
        return { active: false }
    }
    return result
}
