import { describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AccountType } from '@/lib/Auth/Types/account.types.ts'
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

function QueryOwners({ accountType }: { accountType: AccountType }) {
    useUsersTableQuery(accountType)
    useUserManagementLogic(accountType)
    return null
}

function readOwnerQueries(
    actorUserId: string | undefined,
    accountType: AccountType,
    isSuperUser: boolean,
) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    queryClient.setQueryData(['session'], {
        user: actorUserId ? { id: actorUserId } : null,
        permissions: isSuperUser
            ? [PERMISSIONS.ADMIN_SUPER_USER, PERMISSIONS.ADMIN_USER_MANAGEMENT]
            : [PERMISSIONS.ADMIN_USER_MANAGEMENT],
    })
    try {
        renderToStaticMarkup(
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(QueryOwners, { accountType }),
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

describe('account administration query scope', () => {
    it('separates public and staff caches by account type and actor', () => {
        expect(readOwnerQueries('actor-a', 'staff', true)).toEqual([
            { queryKey: ['admin-users', 'staff', 'actor-a'], enabled: true },
            {
                queryKey: ['admin-permissions', 'actor-a', 'staff'],
                enabled: true,
            },
        ])
        expect(readOwnerQueries('actor-b', 'public', false)).toEqual([
            { queryKey: ['admin-users', 'public', 'actor-b'], enabled: true },
            {
                queryKey: ['admin-permissions', 'actor-b', 'public'],
                enabled: true,
            },
        ])
    })

    it('disables protected queries for missing actors and ordinary public-account managers on the staff page', () => {
        for (const queries of [
            readOwnerQueries(undefined, 'public', false),
            readOwnerQueries('actor-a', 'staff', false),
        ]) {
            expect(queries.map(({ enabled }) => enabled)).toEqual([
                false,
                false,
            ])
        }
    })
})
