import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'bun:test'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'

const queryMocks = (function () {
    return {
        queryKey: ['session-from-query-options'] as const,
    }
})()

vi.mock('@/lib/Queries/appQueries.ts', function () {
    return {
        authenticatedSessionQueryOptions: function () {
            return {
                queryKey: queryMocks.queryKey,
            }
        },
    }
})

function createSessionData(): AuthenticatedSessionQueryData & {
    user: NonNullable<AuthenticatedSessionQueryData['user']>
} {
    return {
        permissions: ['admin.dashboard.read'],
        user: {
            bio: null,
            customBackgroundDarkness: 45,
            customBackgroundUpdatedAt: null,
            fontFamily: 'inter',
            fontSize: 16,
            id: 'user-1',
            primaryColor: '#2346d8',
            profileImageVersion: 1,
            themeMode: 'dark',
            username: 'kevin',
        },
    }
}

describe('updateAuthenticatedSessionUserCache', function () {
    it('aktualisiert ausschließlich die angegebenen User-Felder am kanonischen Query-Key', function () {
        const queryClient = new QueryClient()
        const sessionData = createSessionData()
        queryClient.setQueryData(queryMocks.queryKey, sessionData)

        updateAuthenticatedSessionUserCache(queryClient, {
            primaryColor: null,
        })

        expect(
            queryClient.getQueryData<AuthenticatedSessionQueryData>(
                queryMocks.queryKey,
            ),
        ).toEqual({
            ...sessionData,
            user: {
                ...sessionData.user,
                primaryColor: null,
            },
        })
    })

    it('erzeugt ohne angemeldeten User keinen unvollständigen Cache-Eintrag', function () {
        const queryClient = new QueryClient()
        const signedOutSession: AuthenticatedSessionQueryData = { user: null }
        queryClient.setQueryData(queryMocks.queryKey, signedOutSession)

        updateAuthenticatedSessionUserCache(queryClient, {})

        expect(
            queryClient.getQueryData<AuthenticatedSessionQueryData>(
                queryMocks.queryKey,
            ),
        ).toEqual(signedOutSession)
    })
})
