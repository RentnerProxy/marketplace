import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
    permissions,
    sessions,
    accountPermissions,
    users,
} from '@/db/schema.ts'
import { SESSION_COOKIE_NAME } from '@/config/session.config.ts'
import { getSessionTokenCandidateService } from '@/server/Auth/session-token.service.ts'
import type { RealtimeValidationState } from '@/websockets/Types/realtime-validation.types.ts'
import { logError } from '@/server/Logging/logger.ts'
import type { BunRealtimeWebSocket } from '@/websockets/Types/bun.ts'
import type { UserSessionsRevokedEvent } from '@/websockets/Types/events.ts'
import { getRealtimeConnectionTopics } from './realtimeTopics.ts'

const REALTIME_REVALIDATION_INTERVAL_MS = 60_000
const MAX_TIMER_DELAY_MS = 2_147_000_000

declare global {
    var appRealtimeRevocationEpoch: symbol | undefined
    var appRealtimeValidationStates:
        WeakMap<BunRealtimeWebSocket, RealtimeValidationState> | undefined
}

export function getRealtimeRevocationEpoch(): symbol {
    globalThis.appRealtimeRevocationEpoch ??= Symbol()
    return globalThis.appRealtimeRevocationEpoch
}

export function invalidateRealtimeRevocationEpoch() {
    globalThis.appRealtimeRevocationEpoch = Symbol()
}

function getRealtimeValidationStates() {
    globalThis.appRealtimeValidationStates ??= new WeakMap()
    return globalThis.appRealtimeValidationStates
}

function getCookieValue(request: Request, name: string) {
    const cookieHeader = request.headers.get('cookie')

    if (!cookieHeader) {
        return null
    }

    const cookies = cookieHeader.split(';')

    for (const cookie of cookies) {
        const [cookieName, ...cookieValueParts] = cookie.trim().split('=')

        if (cookieName === name) {
            try {
                return decodeURIComponent(cookieValueParts.join('='))
            } catch {
                return null
            }
        }
    }

    return null
}

async function getRealtimeSessionData(
    sessionHash: string,
    absoluteExpiresAt: string,
) {
    const absoluteDeadline = Date.parse(absoluteExpiresAt)
    if (!Number.isFinite(absoluteDeadline) || absoluteDeadline <= Date.now())
        return null
    const sessionRows = await db
        .select({
            userId: users.id,
            username: users.username,
            isActive: users.isActive,
            isDeleted: users.isDeleted,
            expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, sessionHash))
        .limit(1)
    const session = sessionRows.at(0)

    if (
        !session ||
        !session.isActive ||
        session.isDeleted ||
        Date.now() >= Math.min(session.expiresAt.getTime(), absoluteDeadline)
    ) {
        return null
    }

    const permissionRows = await db
        .select({ key: permissions.key })
        .from(accountPermissions)
        .innerJoin(
            permissions,
            eq(permissions.id, accountPermissions.permissionId),
        )
        .where(eq(accountPermissions.userId, session.userId))

    const expiresAt = Math.min(session.expiresAt.getTime(), absoluteDeadline)
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null

    return {
        userId: session.userId,
        username: session.username,
        permissions: permissionRows.map((permission) => permission.key),
        sessionHash,
        expiresAt: new Date(expiresAt).toISOString(),
        absoluteExpiresAt: new Date(absoluteDeadline).toISOString(),
    }
}

export async function getRealtimeConnectionData(request: Request) {
    const revocationEpoch = getRealtimeRevocationEpoch()
    const candidate = await getSessionTokenCandidateService(
        getCookieValue(request, SESSION_COOKIE_NAME),
    )
    if (!candidate) return null
    const data = await getRealtimeSessionData(
        candidate.sessionHash,
        candidate.absoluteExpiresAt.toISOString(),
    )
    return data ? { ...data, revocationEpoch } : null
}

function haveEqualPermissions(left: Array<string>, right: Array<string>) {
    if (left.length !== right.length) {
        return false
    }

    const rightPermissions = new Set(right)
    return left.every((permission) => rightPermissions.has(permission))
}

export function clearRealtimeValidation(websocket: BunRealtimeWebSocket) {
    const states = getRealtimeValidationStates()
    const state = states.get(websocket)

    if (state?.expiryTimer) {
        clearTimeout(state.expiryTimer)
    }
    if (state?.revalidationTimer) {
        clearInterval(state.revalidationTimer)
    }

    states.delete(websocket)
}

export function closeRealtimeSession(
    websocket: BunRealtimeWebSocket,
    code = 4001,
    reason = 'Die Sitzung konnte nicht weiter bestätigt werden.',
) {
    clearRealtimeValidation(websocket)
    for (const topic of getRealtimeConnectionTopics(websocket.data)) {
        websocket.unsubscribe(topic)
    }
    websocket.close(code, reason)
}

export function enforceRealtimeSessionDeadline(
    websocket: BunRealtimeWebSocket,
): boolean {
    const state = getRealtimeValidationStates().get(websocket)
    if (!state || !(state.expiresAtMs > Date.now())) {
        closeRealtimeSession(websocket)
        return false
    }
    return true
}

export function isRealtimeSessionActive(websocket: BunRealtimeWebSocket) {
    return (
        enforceRealtimeSessionDeadline(websocket) &&
        getRealtimeValidationStates().get(websocket)?.isSuspended === false
    )
}

function resumeRealtimeConnection(websocket: BunRealtimeWebSocket) {
    if (!isRealtimeSessionActive(websocket)) return
    const state = getRealtimeValidationStates().get(websocket)
    if (!state) return
    for (const topic of getRealtimeConnectionTopics(websocket.data)) {
        websocket.subscribe(topic)
    }
    if (!state.hasAnnouncedReady) {
        state.hasAnnouncedReady = true
        websocket.send(
            JSON.stringify({
                type: 'connection.ready',
                payload: { connectedAt: new Date().toISOString() },
            }),
        )
    }
}

function scheduleRealtimeExpiry(websocket: BunRealtimeWebSocket) {
    const state = getRealtimeValidationStates().get(websocket)
    if (!state || !enforceRealtimeSessionDeadline(websocket)) return
    if (state.expiryTimer) clearTimeout(state.expiryTimer)
    state.expiryTimer = setTimeout(
        function () {
            if (getRealtimeValidationStates().get(websocket) !== state) return
            if (enforceRealtimeSessionDeadline(websocket))
                scheduleRealtimeExpiry(websocket)
        },
        Math.min(state.expiresAtMs - Date.now(), MAX_TIMER_DELAY_MS),
    )
}

async function revalidateRealtimeConnection(websocket: BunRealtimeWebSocket) {
    const state = getRealtimeValidationStates().get(websocket)
    if (
        !state ||
        !enforceRealtimeSessionDeadline(websocket) ||
        state.isValidating
    )
        return
    state.isValidating = true
    const generation = state.generation
    let needsFreshRead = false
    try {
        const current = await getRealtimeSessionData(
            websocket.data.sessionHash,
            new Date(state.absoluteExpiresAtMs).toISOString(),
        )
        if (getRealtimeValidationStates().get(websocket) !== state) return
        if (!enforceRealtimeSessionDeadline(websocket)) return

        if (state.generation !== generation) {
            needsFreshRead = true
            return
        }
        if (
            !current ||
            current.userId !== websocket.data.userId ||
            !haveEqualPermissions(
                current.permissions,
                websocket.data.permissions,
            )
        ) {
            if (state.pendingRevocation) {
                websocket.send(JSON.stringify(state.pendingRevocation))
            }
            closeRealtimeSession(websocket)
            return
        }
        state.expiresAtMs = Math.min(
            Date.parse(current.expiresAt),
            state.absoluteExpiresAtMs,
        )
        websocket.data.expiresAt = new Date(state.expiresAtMs).toISOString()
        scheduleRealtimeExpiry(websocket)
        if (state.isSuspended) {
            state.isSuspended = false
            state.pendingRevocation = null
            resumeRealtimeConnection(websocket)
        }
    } catch (error) {
        if (getRealtimeValidationStates().get(websocket) !== state) return
        if (!enforceRealtimeSessionDeadline(websocket)) return
        if (state.generation !== generation) {
            needsFreshRead = true
            return
        }
        closeRealtimeSession(websocket, 1011)
        logError('realtime.session_revalidation_failed', error, {
            userId: websocket.data.userId,
        })
    } finally {
        state.isValidating = false
        if (needsFreshRead) void revalidateRealtimeConnection(websocket)
    }
}

export function suspendRealtimeSessionForRevalidation(
    websocket: BunRealtimeWebSocket,
    event: UserSessionsRevokedEvent,
) {
    const state = getRealtimeValidationStates().get(websocket)
    if (!state || !enforceRealtimeSessionDeadline(websocket)) return
    state.generation = Symbol()
    state.pendingRevocation = event
    if (!state.isSuspended) {
        state.isSuspended = true
        for (const topic of getRealtimeConnectionTopics(websocket.data)) {
            websocket.unsubscribe(topic)
        }
    }
    void revalidateRealtimeConnection(websocket)
}

export function startRealtimeValidation(
    websocket: BunRealtimeWebSocket,
): boolean {
    clearRealtimeValidation(websocket)
    const absoluteExpiresAtMs = Date.parse(websocket.data.absoluteExpiresAt)
    const state: RealtimeValidationState = {
        expiresAtMs: Math.min(
            Date.parse(websocket.data.expiresAt),
            absoluteExpiresAtMs,
        ),
        absoluteExpiresAtMs,
        expiryTimer: null,
        revalidationTimer: null,
        isValidating: false,
        generation: Symbol(),
        isSuspended:
            websocket.data.revocationEpoch !== getRealtimeRevocationEpoch(),
        hasAnnouncedReady: false,
        pendingRevocation: null,
    }
    getRealtimeValidationStates().set(websocket, state)
    if (!enforceRealtimeSessionDeadline(websocket)) return false
    scheduleRealtimeExpiry(websocket)
    state.revalidationTimer = setInterval(function () {
        void revalidateRealtimeConnection(websocket)
    }, REALTIME_REVALIDATION_INTERVAL_MS)
    if (state.isSuspended) void revalidateRealtimeConnection(websocket)
    else resumeRealtimeConnection(websocket)
    return true
}
