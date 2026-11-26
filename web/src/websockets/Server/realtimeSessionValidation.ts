import { SESSION_COOKIE_NAME } from '@/config/session.config.ts'
import { getSessionTokenCandidateService } from '@/server/Auth/session-token.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import type { BunRealtimeWebSocket } from '@/websockets/Types/bun.ts'
import type { UserSessionsRevokedEvent } from '@/websockets/Types/events.ts'
import type {
    RealtimeSessionGroup,
    RealtimeSessionSnapshot,
    RealtimeValidationState,
    RealtimeValidationSubject,
} from '@/websockets/Types/realtime-validation.types.ts'
import { unregisterRealtimeConnection } from './realtimeConnections.ts'
import { RealtimeDeadlineQueue } from './realtimeDeadlineQueue.ts'
import { readRealtimeSessionSnapshots } from './realtimeSessionSnapshots.ts'
import { getRealtimeConnectionTopics } from './realtimeTopics.ts'

const REALTIME_REVALIDATION_INTERVAL_MS = 60_000
const REALTIME_VALIDATION_LOOKAHEAD_MS = 1_000
const REALTIME_SESSION_BATCH_SIZE = 128
const MAX_CONCURRENT_VALIDATION_BATCHES = 4
const MAX_TIMER_DELAY_MS = 2_147_000_000

const validationStates = new WeakMap<
    BunRealtimeWebSocket,
    RealtimeValidationState
>()
const sessionGroups = new Map<string, RealtimeSessionGroup>()
const expiryDeadlines = new RealtimeDeadlineQueue<BunRealtimeWebSocket>()
const validationDeadlines = new RealtimeDeadlineQueue<RealtimeSessionGroup>()
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let expiryWakeAt: number | undefined
let validationTimer: ReturnType<typeof setTimeout> | undefined
let validationWakeAt: number | undefined
let validationQueued = false
let inFlightBatches = 0

declare global {
    var appRealtimeRevocationEpoch: symbol | undefined
}

export function getRealtimeRevocationEpoch(): symbol {
    globalThis.appRealtimeRevocationEpoch ??= Symbol()
    return globalThis.appRealtimeRevocationEpoch
}

export function invalidateRealtimeRevocationEpoch() {
    globalThis.appRealtimeRevocationEpoch = Symbol()
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

export async function getRealtimeConnectionData(request: Request) {
    const revocationEpoch = getRealtimeRevocationEpoch()
    const candidate = await getSessionTokenCandidateService(
        getCookieValue(request, SESSION_COOKIE_NAME),
    )
    if (!candidate) return null

    const { sessionHash, absoluteExpiresAt } = candidate
    const absoluteDeadline = absoluteExpiresAt.getTime()
    if (!(absoluteDeadline > Date.now())) return null

    const snapshots = await readRealtimeSessionSnapshots(
        new Map([[sessionHash, absoluteDeadline]]),
    )
    const snapshot = snapshots.get(sessionHash)
    if (!snapshot) return null

    const expiresAtMs = Math.min(snapshot.expiresAtMs, absoluteDeadline)
    if (!(expiresAtMs > Date.now())) return null

    return {
        userId: snapshot.userId,
        username: snapshot.username,
        permissions: snapshot.permissions,
        sessionHash,
        expiresAt: new Date(expiresAtMs).toISOString(),
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        revocationEpoch,
    }
}

function haveEqualPermissions(left: Array<string>, right: Array<string>) {
    if (left.length !== right.length) {
        return false
    }

    const rightPermissions = new Set(right)
    return left.every((permission) => rightPermissions.has(permission))
}

function scheduleExpiryWake() {
    const deadline = expiryDeadlines.peek()?.deadline
    if (deadline === expiryWakeAt) return
    clearTimeout(expiryTimer)
    expiryWakeAt = deadline
    if (deadline === undefined) {
        expiryTimer = undefined
        return
    }
    const timer = setTimeout(
        function () {
            if (expiryTimer !== timer) return
            expiryTimer = undefined
            expiryWakeAt = undefined
            expireRealtimeSessions()
        },
        Math.min(deadline - Date.now(), MAX_TIMER_DELAY_MS),
    )
    expiryTimer = timer
    timer.unref()
}

export function expireRealtimeSessions() {
    let entry = expiryDeadlines.peek()
    while (entry && entry.deadline <= Date.now()) {
        expiryDeadlines.delete(entry.key)
        closeRealtimeSession(entry.key)
        entry = expiryDeadlines.peek()
    }
    scheduleExpiryWake()
}

function scheduleValidationWake() {
    const deadline =
        inFlightBatches < MAX_CONCURRENT_VALIDATION_BATCHES
            ? validationDeadlines.peek()?.deadline
            : undefined
    const now = Date.now()
    if (deadline !== undefined && deadline <= now) {
        clearTimeout(validationTimer)
        validationTimer = undefined
        validationWakeAt = undefined
        if (!validationQueued) {
            validationQueued = true
            queueMicrotask(drainValidationBatch)
        }
        return
    }
    if (deadline === validationWakeAt) return
    clearTimeout(validationTimer)
    validationWakeAt = deadline
    if (deadline === undefined) {
        validationTimer = undefined
        return
    }
    const timer = setTimeout(function () {
        if (validationTimer !== timer) return
        validationTimer = undefined
        validationWakeAt = undefined
        drainValidationBatch()
    }, deadline - now)
    validationTimer = timer
    timer.unref()
}

function queueSessionValidation(group: RealtimeSessionGroup) {
    if (group.isValidating || group.sockets.size === 0) return
    validationDeadlines.set(group, group.dueAtMs)
    scheduleValidationWake()
}

export function clearRealtimeValidation(websocket: BunRealtimeWebSocket) {
    const state = validationStates.get(websocket)
    if (!state) return

    validationStates.delete(websocket)
    if (expiryDeadlines.delete(websocket)) scheduleExpiryWake()
    const { group } = state
    group.sockets.delete(websocket)
    if (group.sockets.size === 0) {
        sessionGroups.delete(group.sessionHash)
        if (validationDeadlines.delete(group)) scheduleValidationWake()
    }
}

export function closeRealtimeSession(
    websocket: BunRealtimeWebSocket,
    code = 4001,
    reason = 'Die Sitzung konnte nicht weiter bestätigt werden.',
) {
    clearRealtimeValidation(websocket)
    unregisterRealtimeConnection(websocket)
    for (const topic of getRealtimeConnectionTopics(websocket.data)) {
        websocket.unsubscribe(topic)
    }
    websocket.close(code, reason)
}

function enforceRealtimeSessionDeadline(websocket: BunRealtimeWebSocket) {
    const state = validationStates.get(websocket)
    if (!state || !(state.expiresAtMs > Date.now())) {
        closeRealtimeSession(websocket)
        return false
    }
    return true
}

export function isRealtimeSessionActive(websocket: BunRealtimeWebSocket) {
    return (
        enforceRealtimeSessionDeadline(websocket) &&
        validationStates.get(websocket)?.isSuspended === false
    )
}

function resumeRealtimeConnection(websocket: BunRealtimeWebSocket) {
    if (!enforceRealtimeSessionDeadline(websocket)) return
    const state = validationStates.get(websocket)
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

function isCurrentValidation({
    websocket,
    state,
    generation,
}: RealtimeValidationSubject) {
    return (
        validationStates.get(websocket) === state &&
        enforceRealtimeSessionDeadline(websocket) &&
        state.generation === generation
    )
}

function applyRealtimeSessionSnapshot(
    { websocket, state }: RealtimeValidationSubject,
    snapshot: RealtimeSessionSnapshot | undefined,
) {
    const expiresAtMs = Math.min(
        snapshot?.expiresAtMs ?? 0,
        state.absoluteExpiresAtMs,
    )
    if (
        !snapshot ||
        !(expiresAtMs > Date.now()) ||
        snapshot.userId !== websocket.data.userId ||
        !haveEqualPermissions(snapshot.permissions, websocket.data.permissions)
    ) {
        if (state.pendingRevocation) {
            websocket.send(JSON.stringify(state.pendingRevocation))
        }
        closeRealtimeSession(websocket)
        return
    }

    state.expiresAtMs = expiresAtMs
    websocket.data.expiresAt = new Date(expiresAtMs).toISOString()
    expiryDeadlines.set(websocket, expiresAtMs)
    scheduleExpiryWake()
    if (state.isSuspended) {
        state.isSuspended = false
        state.pendingRevocation = null
        resumeRealtimeConnection(websocket)
    }
}

async function revalidateSessionBatch(
    subjects: Array<RealtimeValidationSubject>,
    deadlines: Map<string, number>,
) {
    let snapshots
    try {
        snapshots = await readRealtimeSessionSnapshots(deadlines)
    } catch (error) {
        let closedConnections = 0
        for (const subject of subjects) {
            if (!isCurrentValidation(subject)) continue
            closeRealtimeSession(subject.websocket, 1011)
            closedConnections += 1
        }
        if (closedConnections > 0) {
            logError('realtime.session_revalidation_failed', error, {
                closedConnections,
            })
        }
        return
    }

    for (const subject of subjects) {
        if (!isCurrentValidation(subject)) continue
        applyRealtimeSessionSnapshot(
            subject,
            snapshots.get(subject.state.group.sessionHash),
        )
    }
}

function drainValidationBatch() {
    validationQueued = false
    if (inFlightBatches >= MAX_CONCURRENT_VALIDATION_BATCHES) return

    const now = Date.now()
    const earliest = validationDeadlines.peek()
    if (!earliest || earliest.deadline > now) {
        scheduleValidationWake()
        return
    }

    const groups: Array<RealtimeSessionGroup> = []
    const subjects: Array<RealtimeValidationSubject> = []
    const deadlines = new Map<string, number>()
    while (groups.length < REALTIME_SESSION_BATCH_SIZE) {
        const entry = validationDeadlines.peek()
        // Once a read is due, include nearby sessions without delaying the first one.
        if (!entry || entry.deadline > now + REALTIME_VALIDATION_LOOKAHEAD_MS)
            break

        const group = entry.key
        validationDeadlines.delete(group)
        group.isValidating = true
        group.dueAtMs =
            Math.max(entry.deadline, now) + REALTIME_REVALIDATION_INTERVAL_MS
        groups.push(group)
        let absoluteDeadline = 0
        for (const websocket of group.sockets) {
            const state = validationStates.get(websocket)
            if (!state || !enforceRealtimeSessionDeadline(websocket)) continue
            subjects.push({ websocket, state, generation: state.generation })
            absoluteDeadline = Math.max(
                absoluteDeadline,
                state.absoluteExpiresAtMs,
            )
        }
        if (absoluteDeadline > now)
            deadlines.set(group.sessionHash, absoluteDeadline)
    }

    if (groups.length > 0) {
        inFlightBatches += 1
        void revalidateSessionBatch(subjects, deadlines).finally(function () {
            inFlightBatches -= 1
            for (const group of groups) {
                group.isValidating = false
                queueSessionValidation(group)
            }
            scheduleValidationWake()
        })
    }
    scheduleValidationWake()
}

export function suspendRealtimeSessionForRevalidation(
    websocket: BunRealtimeWebSocket,
    event: UserSessionsRevokedEvent,
) {
    const state = validationStates.get(websocket)
    if (!state || !enforceRealtimeSessionDeadline(websocket)) return
    state.generation = Symbol()
    state.pendingRevocation = event
    if (!state.isSuspended) {
        state.isSuspended = true
        for (const topic of getRealtimeConnectionTopics(websocket.data)) {
            websocket.unsubscribe(topic)
        }
    }
    state.group.dueAtMs = Date.now()
    queueSessionValidation(state.group)
}

export function startRealtimeValidation(
    websocket: BunRealtimeWebSocket,
): boolean {
    clearRealtimeValidation(websocket)
    const { sessionHash } = websocket.data
    const group = sessionGroups.get(sessionHash) ?? {
        sessionHash,
        sockets: new Set<BunRealtimeWebSocket>(),
        dueAtMs: Date.now() + REALTIME_REVALIDATION_INTERVAL_MS,
        isValidating: false,
    }
    const absoluteExpiresAtMs = Date.parse(websocket.data.absoluteExpiresAt)
    const state: RealtimeValidationState = {
        expiresAtMs: Math.min(
            Date.parse(websocket.data.expiresAt),
            absoluteExpiresAtMs,
        ),
        absoluteExpiresAtMs,
        group,
        generation: Symbol(),
        isSuspended:
            websocket.data.revocationEpoch !== getRealtimeRevocationEpoch(),
        hasAnnouncedReady: false,
        pendingRevocation: null,
    }
    group.sockets.add(websocket)
    sessionGroups.set(sessionHash, group)
    validationStates.set(websocket, state)
    if (!enforceRealtimeSessionDeadline(websocket)) return false
    expiryDeadlines.set(websocket, state.expiresAtMs)
    scheduleExpiryWake()
    if (state.isSuspended) group.dueAtMs = Date.now()
    queueSessionValidation(group)
    if (!state.isSuspended) resumeRealtimeConnection(websocket)
    return true
}
