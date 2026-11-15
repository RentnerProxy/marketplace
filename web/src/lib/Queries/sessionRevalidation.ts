import type { QueryCacheNotifyEvent } from '@tanstack/react-query'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type {
    SessionRevalidationOptions,
    SessionRevalidationResult,
} from './Types/session-revalidation.types.ts'
import {
    AUTHENTICATED_SESSION_QUERY_KEY,
    setAuthenticatedSessionQueryData,
} from './authenticatedSessionCache.ts'

export function isAuthenticatedSessionCacheUpdate(
    event: QueryCacheNotifyEvent,
): boolean {
    const key = event.query.queryKey
    if (
        key.length !== AUTHENTICATED_SESSION_QUERY_KEY.length ||
        key[0] !== AUTHENTICATED_SESSION_QUERY_KEY[0]
    )
        return false
    return (
        event.type === 'added' ||
        event.type === 'removed' ||
        (event.type === 'updated' &&
            (event.action.type === 'success' ||
                event.action.type === 'setState'))
    )
}

export async function revalidateCurrentSession(
    options: SessionRevalidationOptions,
): Promise<SessionRevalidationResult> {
    if (options.signal.aborted) return 'stale'
    await options.queryClient.cancelQueries({
        queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
        exact: true,
    })
    if (options.signal.aborted) return 'stale'
    const cache = options.queryClient.getQueryCache()
    const getSession = () =>
        options.queryClient.getQueryData<AuthenticatedSessionQueryData>(
            AUTHENTICATED_SESSION_QUERY_KEY,
        )
    const expected = getSession()
    const expectedQuery = cache.find({
        queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
        exact: true,
    })
    let revised = false
    const abort = new AbortController()
    let rejectCancellation: ((reason: Error) => void) | undefined
    const cancellation = new Promise<never>(function (_, reject) {
        rejectCancellation = reject
    })
    function cancel() {
        rejectCancellation?.(new Error('Session revalidation cancelled'))
        abort.abort()
    }

    void cancellation.catch(function () {})
    const unsubscribe = cache.subscribe(function (event) {
        if (!isAuthenticatedSessionCacheUpdate(event)) return
        revised = true
        cancel()
    })
    options.signal.addEventListener('abort', cancel, { once: true })
    const cancelTimeout = options.schedule(cancel, options.requestTimeoutMs)
    try {
        const session = await Promise.race([
            cancellation,
            options.readSession(abort.signal),
        ])
        if (
            options.signal.aborted ||
            revised ||
            getSession() !== expected ||
            cache.find({
                queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
                exact: true,
            }) !== expectedQuery
        ) {
            return 'stale'
        }
        if (!session?.user && session?.user !== null) return 'unavailable'

        unsubscribe()
        const written = setAuthenticatedSessionQueryData(
            options.queryClient,
            session,
        )
        if (getSession() !== written) return 'stale'
        if (session.user === null) {
            options.queryClient.removeQueries({
                predicate(query) {
                    const key = query.queryKey
                    return (
                        key.length !== AUTHENTICATED_SESSION_QUERY_KEY.length ||
                        key[0] !== AUTHENTICATED_SESSION_QUERY_KEY[0]
                    )
                },
            })
            if (getSession() !== written) return 'stale'
            options.onInactive()
            return 'inactive'
        }
        return 'active'
    } catch {
        return options.signal.aborted || revised ? 'stale' : 'unavailable'
    } finally {
        cancelTimeout()
        unsubscribe()
        options.signal.removeEventListener('abort', cancel)
    }
}
