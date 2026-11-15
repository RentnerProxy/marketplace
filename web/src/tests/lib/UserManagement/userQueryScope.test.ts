import { describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PERMISSIONS } from '@/config/permissions.config.ts'

vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({
        queryKey: ['session'],
        queryFn: vi.fn(),
    }),
}))
vi.mock('@/features/Admin/UserManagement/middleware.ts', () => ({
    getUsersHandler: vi.fn(),
    getPermissionsHandler: vi.fn(),
}))
vi.mock('@/features/Admin/UserManagement/Hooks/useCreateUserForm.ts', () => ({
    default: () => ({ state: {}, handler: {}, form: {} }),
}))
vi.mock('@/features/Admin/UserManagement/Hooks/useUserEditor.ts', () => ({
    default: () => ({ state: {}, handler: {} }),
}))
vi.mock(
    '@/features/Admin/UserManagement/Hooks/useUserAccountActions.ts',
    () => ({
        default: () => ({ state: {}, handler: {} }),
    }),
)
vi.mock(
    '@/features/Admin/UserManagement/Hooks/useUserManagementRealtime.ts',
    () => ({
        default: () => undefined,
    }),
)

const { default: useUsersTableQuery } =
    await import('@/features/Admin/UserManagement/Components/UsersTable/Hooks/useUsersTableQuery.ts')
const { default: useUserManagementLogic } =
    await import('@/features/Admin/UserManagement/Hooks/useUserManagementLogic.ts')

function QueryOwners() {
    useUsersTableQuery()
    useUserManagementLogic()
    return null
}

function readOwnerQueries(actorUserId: string | undefined, full: boolean) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    queryClient.setQueryData(['session'], {
        user: actorUserId ? { id: actorUserId } : null,
        permissions: full ? [PERMISSIONS.ADMIN_SUPER_USER] : [],
    })
    try {
        renderToStaticMarkup(
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(QueryOwners),
            ),
        )
        return ['admin-users', 'admin-permissions'].map((baseKey) => {
            const query = queryClient
                .getQueryCache()
                .find({ queryKey: [baseKey], exact: false })
            return {
                queryKey: query?.queryKey,
                enabled:
                    query && 'enabled' in query.options
                        ? query.options.enabled
                        : undefined,
            }
        })
    } finally {
        queryClient.clear()
    }
}

describe('UserManagement Query-Keys an ihren Ownern', function () {
    it('trennt vollständige und eingeschränkte Akteurssichten', function () {
        const full = readOwnerQueries('actor-a', true)
        const restricted = readOwnerQueries('actor-a', false)
        const otherActor = readOwnerQueries('actor-b', true)
        expect(full).toEqual([
            { queryKey: ['admin-users', 'actor-a', 'full'], enabled: true },
            {
                queryKey: ['admin-permissions', 'actor-a', 'full'],
                enabled: true,
            },
        ])
        expect(restricted).toEqual([
            {
                queryKey: ['admin-users', 'actor-a', 'restricted'],
                enabled: true,
            },
            {
                queryKey: ['admin-permissions', 'actor-a', 'restricted'],
                enabled: true,
            },
        ])
        expect(otherActor).toEqual([
            { queryKey: ['admin-users', 'actor-b', 'full'], enabled: true },
            {
                queryKey: ['admin-permissions', 'actor-b', 'full'],
                enabled: true,
            },
        ])
        expect(full).not.toEqual(restricted)
        expect(full).not.toEqual(otherActor)
    })

    it('führt ohne aktuellen Akteur keine geschützte Listenabfrage aus', function () {
        expect(readOwnerQueries(undefined, false)).toEqual([
            {
                queryKey: ['admin-users', 'anonymous', 'restricted'],
                enabled: false,
            },
            {
                queryKey: ['admin-permissions', 'anonymous', 'restricted'],
                enabled: false,
            },
        ])
    })
})
