import { scheduleCancelableTimeout } from '@/lib/Browser/scheduleCancelableTimeout.ts'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { sessionConfig } from '@/config/session.config.ts'
import { validateSessionHandler } from '@/features/Auth/middleware.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { revalidateCurrentSession } from '@/lib/Queries/sessionRevalidation.ts'
import { resetAppThemeSettings } from '@/lib/Theme/appTheme.ts'

type SecurityChangeSessionIdentity = {
    userId: string
    absoluteExpiresAt: string | undefined
}

export default function useSecurityChangeSession() {
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const sessionQuery = useQuery(authenticatedSessionQueryOptions())
    const [reauthenticationSession, setReauthenticationSession] =
        useState<SecurityChangeSessionIdentity | null>(null)
    const request = useRef<AbortController | null>(null)
    const mounted = useRef(false)
    const userId = sessionQuery.data?.user?.id
    const absoluteExpiry = sessionQuery.data?.absoluteExpiresAt
    const isReauthenticationRequired = Boolean(
        reauthenticationSession &&
        reauthenticationSession.userId === userId &&
        reauthenticationSession.absoluteExpiresAt === absoluteExpiry,
    )

    useEffect(function () {
        mounted.current = true
        return function () {
            mounted.current = false
            request.current?.abort()
            request.current = null
        }
    }, [])

    async function completeSecurityChange() {
        if (!mounted.current || !userId) return
        setReauthenticationSession({
            userId,
            absoluteExpiresAt: absoluteExpiry,
        })
        request.current?.abort()
        const currentRequest = new AbortController()
        request.current = currentRequest
        const result = await revalidateCurrentSession({
            queryClient,
            signal: currentRequest.signal,
            readSession: (signal) => validateSessionHandler({ signal }),
            onInactive() {
                if (!mounted.current) return
                resetAppThemeSettings()
                void navigate({ to: '/login' }).catch(function () {})
            },
            requestTimeoutMs: sessionConfig.activityRequestTimeoutMs,
            schedule: scheduleCancelableTimeout,
        })
        if (request.current !== currentRequest) return
        request.current = null
        if (mounted.current && result === 'active')
            setReauthenticationSession(null)
    }

    return {
        state: {
            currentSessionUser: sessionQuery.data?.user,
            hasCurrentSession: Boolean(sessionQuery.data?.user),
            isReauthenticationRequired,
        },
        handler: { completeSecurityChange },
    }
}
