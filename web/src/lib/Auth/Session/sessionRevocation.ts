import { AUTHENTICATED_SESSION_QUERY_KEY } from '@/lib/Queries/appQueries.ts'
import { isAuthenticatedSessionCacheUpdate } from '@/lib/Queries/sessionRevalidation.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type {
    SessionRevocationController,
    SessionRevocationControllerOptions,
} from './Types/session-revocation.types.ts'

export function createSessionRevocationController(
    options: SessionRevocationControllerOptions,
): SessionRevocationController {
    const getSession = () =>
        options.queryClient.getQueryData<AuthenticatedSessionQueryData>(
            AUTHENTICATED_SESSION_QUERY_KEY,
        )
    let userId = getSession()?.user?.id
    let absoluteExpiry = userId ? getSession()?.absoluteExpiresAt : undefined
    let disposed = false
    let pending = false
    let hasRetriedStale = false
    let lastStarted: number | null = null
    let activeRequest: AbortController | null = null
    let cancelPendingTimer: (() => void) | null = null

    function clearPendingTimer() {
        cancelPendingTimer?.()
        cancelPendingTimer = null
    }

    function invalidateRequest() {
        const request = activeRequest
        activeRequest = null
        request?.abort()
    }

    function checkPending() {
        if (disposed || !pending || activeRequest !== null) return
        if (!getSession()?.user) {
            pending = false
            clearPendingTimer()
            return
        }
        const now = options.monotonicNow()
        if (!Number.isFinite(now) || now < 0) return
        const delay =
            lastStarted === null ? 0 : options.throttleMs - (now - lastStarted)
        if (delay > 0) {
            if (cancelPendingTimer === null) {
                cancelPendingTimer = options.schedule(function () {
                    cancelPendingTimer = null
                    checkPending()
                }, delay)
            }
            return
        }
        clearPendingTimer()
        pending = false
        lastStarted = now
        const request = new AbortController()
        activeRequest = request
        void options
            .validate(request.signal)
            .then(function (result) {
                if (
                    result === 'stale' &&
                    !disposed &&
                    activeRequest === request &&
                    !pending &&
                    !hasRetriedStale
                ) {
                    hasRetriedStale = true
                    pending = true
                }
                return result
            })
            .catch(function () {})
            .finally(function () {
                if (disposed || activeRequest !== request) return
                activeRequest = null
                checkPending()
            })
    }

    const unsubscribe = options.queryClient
        .getQueryCache()
        .subscribe(function (event) {
            if (!isAuthenticatedSessionCacheUpdate(event)) return
            const next = getSession()
            const nextUserId = next?.user?.id
            const nextAbsoluteExpiry = nextUserId
                ? next?.absoluteExpiresAt
                : undefined
            if (nextUserId === userId && nextAbsoluteExpiry === absoluteExpiry)
                return
            userId = nextUserId
            absoluteExpiry = nextAbsoluteExpiry
            pending = false
            hasRetriedStale = false
            lastStarted = null
            clearPendingTimer()
            invalidateRequest()
        })

    return {
        request(revokedUserId) {
            if (disposed || getSession()?.user?.id !== revokedUserId) return
            pending = true
            hasRetriedStale = false

            activeRequest?.abort()
            checkPending()
        },
        dispose() {
            if (disposed) return
            disposed = true
            pending = false
            unsubscribe()
            clearPendingTimer()
            invalidateRequest()
        },
    }
}
