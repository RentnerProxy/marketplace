import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
    touchSessionActivityHandler,
    validateSessionHandler,
} from '@/features/Auth/middleware.ts'
import { sessionConfig } from '@/config/session.config.ts'
import {
    AUTHENTICATED_SESSION_QUERY_KEY,
    setAuthenticatedSessionQueryData,
} from '@/lib/Queries/authenticatedSessionCache.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import { createSessionActivityController } from '@/lib/Auth/Session/sessionActivity.ts'

export default function useSessionActivity(): void {
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    useEffect(
        function () {
            let revision = 0
            const getSession = () =>
                queryClient.getQueryData<AuthenticatedSessionQueryData>(
                    AUTHENTICATED_SESSION_QUERY_KEY,
                )
            const controller = createSessionActivityController({
                target: document,
                isVisible: () => document.visibilityState === 'visible',
                getSnapshot: () => ({ revision, session: getSession() }),
                touchSession: (signal) =>
                    touchSessionActivityHandler({ signal }),
                readSession: (signal) => validateSessionHandler({ signal }),
                commitSession(expected, session) {
                    if (
                        revision !== expected.revision ||
                        getSession() !== expected.session
                    ) {
                        return false
                    }
                    const written = setAuthenticatedSessionQueryData(
                        queryClient,
                        session,
                    )
                    return getSession() === written
                },
                onInactive() {
                    if (getSession()?.user !== null) return
                    void navigate({ to: '/login' }).catch(function () {})
                },
                wallNow: () => Date.now(),
                monotonicNow: () => performance.now(),
                schedule(callback, delay) {
                    const timer = window.setTimeout(callback, delay)
                    return () => window.clearTimeout(timer)
                },
                idleDurationMs: sessionConfig.idleDurationMs,
                activityThrottleMs: sessionConfig.activityThrottleMs,
                activityReadRetryLimit: sessionConfig.activityReadRetryLimit,
                activityRequestTimeoutMs:
                    sessionConfig.activityRequestTimeoutMs,
            })
            const unsubscribe = queryClient
                .getQueryCache()
                .subscribe(function (event) {
                    const key = event.query.queryKey
                    if (
                        key.length !== AUTHENTICATED_SESSION_QUERY_KEY.length ||
                        key[0] !== AUTHENTICATED_SESSION_QUERY_KEY[0]
                    )
                        return
                    if (
                        event.type !== 'added' &&
                        event.type !== 'removed' &&
                        !(
                            event.type === 'updated' &&
                            (event.action.type === 'success' ||
                                event.action.type === 'setState')
                        )
                    )
                        return
                    revision += 1
                    controller.refresh()
                })

            return function () {
                unsubscribe()
                controller.dispose()
            }
        },
        [navigate, queryClient],
    )
}
