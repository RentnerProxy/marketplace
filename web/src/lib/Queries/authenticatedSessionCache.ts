import type { QueryClient } from '@tanstack/react-query'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'

export const AUTHENTICATED_SESSION_QUERY_KEY = [
    'authenticated-session',
] as const

export function clearAuthenticatedQueryCache(queryClient: QueryClient): void {
    // Removal cancels even fetches whose readers ignore their abort signal.
    queryClient.removeQueries()
}

export function removeStaleAuthenticatedQueryData(
    queryClient: QueryClient,
    session: AuthenticatedSessionQueryData,
): void {
    const current = queryClient.getQueryData<AuthenticatedSessionQueryData>(
        AUTHENTICATED_SESSION_QUERY_KEY,
    )
    if (current?.user?.id === session.user?.id) return

    queryClient.removeQueries({
        predicate(query) {
            const key = query.queryKey
            return (
                key.length !== AUTHENTICATED_SESSION_QUERY_KEY.length ||
                key[0] !== AUTHENTICATED_SESSION_QUERY_KEY[0]
            )
        },
    })
}

export function setAuthenticatedSessionQueryData(
    queryClient: QueryClient,
    session: AuthenticatedSessionQueryData,
) {
    const current = queryClient.getQueryData<AuthenticatedSessionQueryData>(
        AUTHENTICATED_SESSION_QUERY_KEY,
    )
    if (current?.user?.id !== session.user?.id) {
        void queryClient.cancelQueries({
            queryKey: AUTHENTICATED_SESSION_QUERY_KEY,
            exact: true,
        })
    }
    removeStaleAuthenticatedQueryData(queryClient, session)
    return queryClient.setQueryData(AUTHENTICATED_SESSION_QUERY_KEY, session)
}
