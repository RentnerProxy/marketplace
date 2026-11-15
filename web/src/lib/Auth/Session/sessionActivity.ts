import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type {
    SessionActivityController,
    SessionActivityControllerOptions,
    SessionActivityRequest,
    SessionActivitySnapshot,
} from './Types/session-activity.types.ts'

const activityEvents = [
    'pointerdown',
    'keydown',
    'wheel',
    'touchstart',
] as const

function parseDeadline(value: unknown): number | null {
    if (typeof value !== 'string') return null
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
        ? parsed
        : null
}

function getDeadline(session: AuthenticatedSessionQueryData): number | null {
    const idle = parseDeadline(session.expiresAt)
    const absolute = parseDeadline(session.absoluteExpiresAt)
    return idle !== null && absolute !== null && idle <= absolute
        ? Math.min(idle, absolute)
        : null
}

export function createSessionActivityController(
    options: SessionActivityControllerOptions,
): SessionActivityController {
    let disposed = false
    let cancelTimer: (() => void) | null = null
    let inFlight: SessionActivityRequest | null = null
    let lastActivityAttemptAt: number | null = null
    let readAttempts = 0
    let observedRevision: number | undefined
    let currentUserId: string | undefined
    let currentAbsoluteExpiry: string | undefined

    function clearTimer() {
        cancelTimer?.()
        cancelTimer = null
    }

    function startRequest(): SessionActivityRequest {
        const abortController = new AbortController()
        let rejectCancellation: ((reason: Error) => void) | undefined
        const cancellation = new Promise<never>(function (_, reject) {
            rejectCancellation = reject
        })
        function cancel() {
            rejectCancellation?.(
                new Error('Session activity request cancelled'),
            )
            abortController.abort()
        }

        void cancellation.catch(function () {})
        const request = {
            signal: abortController.signal,
            cancellation,
            cancel,
            cancelTimeout: options.schedule(
                cancel,
                options.activityRequestTimeoutMs,
            ),
        }
        inFlight = request
        return request
    }

    function invalidateRequest() {
        const request = inFlight
        inFlight = null
        request?.cancelTimeout()
        request?.cancel()
    }

    function finishRequest(request: SessionActivityRequest): boolean {
        if (inFlight !== request) return false
        request.cancelTimeout()
        inFlight = null
        return true
    }

    function isCurrent(expected: SessionActivitySnapshot) {
        if (disposed) return false
        const current = options.getSnapshot()
        return (
            current.revision === expected.revision &&
            current.session === expected.session
        )
    }

    function refresh() {
        if (disposed) return
        clearTimer()
        const snapshot = options.getSnapshot()
        const session = snapshot.session
        const revised = snapshot.revision !== observedRevision
        observedRevision = snapshot.revision
        const userId = session?.user?.id
        const absoluteExpiry = userId ? session?.absoluteExpiresAt : undefined
        if (
            currentUserId !== userId ||
            currentAbsoluteExpiry !== absoluteExpiry
        ) {
            currentUserId = userId
            currentAbsoluteExpiry = absoluteExpiry
            readAttempts = 0
            lastActivityAttemptAt = null

            invalidateRequest()
        }
        if (!session?.user) {
            readAttempts = 0
            return
        }
        const deadline = getDeadline(session)
        const now = options.wallNow()
        const future = deadline !== null && deadline > now
        if (future && revised) readAttempts = 0
        if (inFlight !== null) return
        if (readAttempts > options.activityReadRetryLimit) return

        const delay =
            readAttempts > 0
                ? options.activityThrottleMs
                : future
                  ? Math.min(deadline - now, options.idleDurationMs)
                  : 0
        cancelTimer = options.schedule(function () {
            cancelTimer = null
            if (!isCurrent(snapshot)) {
                refresh()
                return
            }
            void readCurrentSession()
        }, delay)
    }

    async function readCurrentSession() {
        if (disposed || inFlight !== null) return
        const expected = options.getSnapshot()
        if (
            !expected.session?.user ||
            readAttempts > options.activityReadRetryLimit
        )
            return

        clearTimer()
        readAttempts += 1
        const request = startRequest()
        try {
            const session = await Promise.race([
                request.cancellation,
                options.readSession(request.signal),
            ])
            if (inFlight !== request || !isCurrent(expected)) return
            if (session?.user === null) {
                if (options.commitSession(expected, session))
                    options.onInactive()
            } else if (session?.user && getDeadline(session) !== null) {
                if ((getDeadline(session) ?? 0) > options.wallNow())
                    readAttempts = 0
                options.commitSession(expected, session)
            }
        } catch {
        } finally {
            if (finishRequest(request)) refresh()
        }
    }

    async function touchCurrentSession(expected: SessionActivitySnapshot) {
        const request = startRequest()
        let needsRead = false
        try {
            const result = await Promise.race([
                request.cancellation,
                options.touchSession(request.signal),
            ])
            if (inFlight !== request || !isCurrent(expected)) return
            const expiry = result?.active
                ? parseDeadline(result.expiresAt)
                : null
            const absolute = parseDeadline(expected.session?.absoluteExpiresAt)
            if (
                result?.active &&
                expiry !== null &&
                absolute !== null &&
                expiry > options.wallNow() &&
                expiry <= absolute &&
                expected.session?.user
            ) {
                options.commitSession(expected, {
                    ...expected.session,
                    expiresAt: result.expiresAt,
                })
            } else {
                needsRead = true
            }
        } catch {
            needsRead = inFlight === request && isCurrent(expected)
        } finally {
            if (finishRequest(request)) {
                if (needsRead && isCurrent(expected)) {
                    void readCurrentSession()
                } else {
                    refresh()
                }
            }
        }
    }

    function onActivity(event: Event) {
        if (disposed || !event.isTrusted || !options.isVisible()) return
        const expected = options.getSnapshot()
        if (!expected.session?.user || inFlight !== null) return
        const now = options.monotonicNow()
        if (!Number.isFinite(now) || now < 0) return
        if (
            lastActivityAttemptAt !== null &&
            now - lastActivityAttemptAt < options.activityThrottleMs
        )
            return
        lastActivityAttemptAt = now
        readAttempts = 0
        clearTimer()
        const deadline = getDeadline(expected.session)
        if (deadline === null || deadline <= options.wallNow()) {
            void readCurrentSession()
        } else {
            void touchCurrentSession(expected)
        }
    }

    for (const event of activityEvents) {
        options.target.addEventListener(event, onActivity, {
            passive: true,
            capture: true,
        })
    }
    refresh()

    return {
        refresh,
        dispose() {
            if (disposed) return
            disposed = true
            clearTimer()
            invalidateRequest()
            for (const event of activityEvents) {
                options.target.removeEventListener(event, onActivity, true)
            }
        },
    }
}
