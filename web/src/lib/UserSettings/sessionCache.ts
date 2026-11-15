import type { AuthenticatedSessionUser } from '@/features/UserSettings/Types/user-settings-domain.types.ts'
import type { QueryClient } from '@tanstack/react-query'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'

export function updateAuthenticatedSessionUserCache(
    queryClient: QueryClient,
    userPatch: Readonly<Partial<AuthenticatedSessionUser>>,
) {
    queryClient.setQueryData<AuthenticatedSessionQueryData | undefined>(
        authenticatedSessionQueryOptions().queryKey,
        function (current) {
            if (!current?.user) {
                return current
            }

            return {
                ...current,
                user: {
                    ...current.user,
                    ...userPatch,
                },
            }
        },
    )
}
