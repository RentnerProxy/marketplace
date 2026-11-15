import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { validateSessionHandler } from '@/features/Auth/middleware.ts'
import { AUTHENTICATED_SESSION_QUERY_KEY } from '@/lib/Queries/appQueries.ts'
import { redirectWhenMissingConfiguredPermission } from '@/lib/Routes/routeRedirects.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'

export async function requireAuthenticatedRoute(redirectTo?: string) {
    const session = await validateSessionHandler()

    if (!session.user) {
        throw redirect({ to: '/login' })
    }

    if (session.maintenance.isActive && !session.canBypassMaintenance) {
        throw redirect({
            to: '/maintenance',
            search: redirectTo ? { redirect: redirectTo } : undefined,
        })
    }

    return session
}

export async function requireConfiguredPermissionRouteFromQueryClient(
    queryClient: QueryClient,
    pathname: string,
) {
    const session =
        queryClient.getQueryData<AuthenticatedSessionQueryData>(
            AUTHENTICATED_SESSION_QUERY_KEY,
        ) ?? (await requireAuthenticatedRoute(pathname))

    redirectWhenMissingConfiguredPermission(pathname, session.permissions)
}
