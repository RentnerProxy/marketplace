import { getCookie } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, user_settings, users } from '@/db/schema.ts'
import { SESSION_COOKIE_NAME } from '@/config/session.config.ts'
import { hasSuperUserPermission } from '@/lib/Permissions/permissions.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { getSessionTokenCandidateService } from './session-token.service.ts'
import type { ActiveSessionState } from './Types/session-activity.types.ts'

function isActiveSession<T extends ActiveSessionState>(
    session: T | null | undefined,
    absoluteExpiresAt: Date,
): session is T {
    const nowMs = Date.now()
    return Boolean(
        session &&
        session.isActive &&
        !session.isDeleted &&
        Math.min(session.expiresAt.getTime(), absoluteExpiresAt.getTime()) >
            nowMs,
    )
}

async function getCurrentSessionCandidate() {
    return getSessionTokenCandidateService(getCookie(SESSION_COOKIE_NAME))
}

export async function getCurrentSessionUserId() {
    const candidate = await getCurrentSessionCandidate()
    if (!candidate) return null

    const sessionRows = await db
        .select({
            userId: sessions.userId,
            isDeleted: users.isDeleted,
            isActive: users.isActive,
            expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, candidate.sessionHash))
        .limit(1)
    const session = sessionRows.at(0)

    return isActiveSession(session, candidate.absoluteExpiresAt)
        ? session.userId
        : null
}

export async function getCurrentUserAccess() {
    const session = await getActiveCurrentSessionUser()
    const permissionKeys = session
        ? await getUserPermissionKeys(session.id)
        : []
    if (!session || session.expiresAt.getTime() <= Date.now()) {
        return { userId: null, permissionKeys: [], isSuperUser: false }
    }

    return {
        userId: session.id,
        permissionKeys,
        isSuperUser: hasSuperUserPermission(permissionKeys),
    }
}

export async function getActiveCurrentSessionUser() {
    const candidate = await getCurrentSessionCandidate()
    if (!candidate) return null

    const rows = await db
        .select({
            id: users.id,
            sessionHash: sessions.id,
            username: users.username,
            email: users.email,
            accountType: users.accountType,
            emailVerifiedAt: users.emailVerifiedAt,
            isActive: users.isActive,
            isDeleted: users.isDeleted,
            expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, candidate.sessionHash))
        .limit(1)
    const session = rows.at(0)

    if (!isActiveSession(session, candidate.absoluteExpiresAt)) return null

    return {
        ...session,
        expiresAt: new Date(
            Math.min(
                session.expiresAt.getTime(),
                candidate.absoluteExpiresAt.getTime(),
            ),
        ),
    }
}

export async function getCurrentUserSettingsSession() {
    const candidate = await getCurrentSessionCandidate()
    if (!candidate) return null

    const result = await db
        .select({
            id: users.id,
            username: users.username,
            email: users.email,
            customBackgroundDarkness: user_settings.customBackgroundDarkness,
            fontFamily: user_settings.fontFamily,
            fontSize: user_settings.fontSize,
            primaryColor: user_settings.primaryColor,
            themeMode: user_settings.themeMode,
            isActive: users.isActive,
            isDeleted: users.isDeleted,
            expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .leftJoin(user_settings, eq(user_settings.userId, users.id))
        .where(eq(sessions.id, candidate.sessionHash))
        .limit(1)

    const session = result.at(0)
    if (!isActiveSession(session, candidate.absoluteExpiresAt)) return null

    return {
        ...session,
        expiresAt: new Date(
            Math.min(
                session.expiresAt.getTime(),
                candidate.absoluteExpiresAt.getTime(),
            ),
        ),
    }
}
