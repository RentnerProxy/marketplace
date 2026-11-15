import { describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PERMISSION_MANAGEMENT_USERS_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'

vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({
        queryKey: ['session'],
        queryFn: vi.fn(),
    }),
}))
vi.mock('@/features/Admin/PermissionManagement/middleware.ts', () => ({
    getPermissionManagementUsersHandler: vi.fn(),
    replaceManagedUserPermissionsHandler: vi.fn(),
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))

const { default: useManagedUserPermissions } =
    await import('@/features/Admin/PermissionManagement/Hooks/useManagedUserPermissions.ts')

function readOwnerQuery(actorUserId: string | undefined, enabled = true) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    queryClient.setQueryData(['session'], {
        user: actorUserId ? { id: actorUserId } : null,
    })
    function QueryOwner() {
        useManagedUserPermissions({ enabled, presets: [] })
        return null
    }
    try {
        renderToStaticMarkup(
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(QueryOwner),
            ),
        )
        const query = queryClient.getQueryCache().find({
            queryKey: PERMISSION_MANAGEMENT_USERS_QUERY_KEY,
            exact: false,
        })
        return {
            queryKey: query?.queryKey,
            enabled:
                query && 'enabled' in query.options
                    ? query.options.enabled
                    : undefined,
        }
    } finally {
        queryClient.clear()
    }
}

describe('PermissionManagement Query-Keys an ihrem Owner', function () {
    it('trennt Benutzerlisten verschiedener Akteure', function () {
        const first = readOwnerQuery('actor-a')
        const second = readOwnerQuery('actor-b')
        expect(first).toEqual({
            queryKey: ['admin-permission-management', 'users', 'actor-a'],
            enabled: true,
        })
        expect(second).toEqual({
            queryKey: ['admin-permission-management', 'users', 'actor-b'],
            enabled: true,
        })
        expect(first).not.toEqual(second)
    })

    it('deaktiviert die Benutzerabfrage ohne Akteur und außerhalb des Benutzertabs', function () {
        expect(readOwnerQuery(undefined)).toEqual({
            queryKey: ['admin-permission-management', 'users', 'anonymous'],
            enabled: false,
        })
        expect(readOwnerQuery('actor-a', false)).toEqual({
            queryKey: ['admin-permission-management', 'users', 'actor-a'],
            enabled: false,
        })
    })
})
