import * as actualQuery from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'

const actualQueryExports = { ...actualQuery }
const queryClient = new actualQuery.QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
})
const mocks = {
    logout: vi.fn(async function () {}),
    navigate: vi.fn(async function () {}),
    resetTheme: vi.fn(),
    appError: vi.fn(),
}
const promises: Array<Promise<unknown>> = []

vi.mock('@tanstack/react-query', () => ({
    ...actualQueryExports,
    useQueryClient: () => queryClient,
    useMutation(options: actualQuery.MutationObserverOptions<void>) {
        const observer = new actualQueryExports.MutationObserver(
            queryClient,
            options,
        )
        return {
            isPending: false,
            mutate() {
                promises.push(observer.mutate().catch(function () {}))
            },
        }
    },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/features/Auth/middleware.ts', () => ({
    logoutHandler: mocks.logout,
}))
vi.mock('@/lib/Theme/appTheme.ts', () => ({
    resetAppThemeSettings: mocks.resetTheme,
}))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: mocks.appError,
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedShellUiStore.ts',
    () => ({
        default: () => ({
            state: { isCollapsed: false, openGroups: [] },
            handler: {
                toggleCollapse: vi.fn(),
                toggleGroup: vi.fn(),
            },
        }),
    }),
)

import useAuthenticatedSidebarLogic from '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedSidebarLogic.ts'

beforeEach(function () {
    vi.clearAllMocks()
    promises.length = 0
    queryClient.setQueryData(['notifications'], ['private-marker-A'])
    queryClient.setQueryData(['current-user-passkeys'], ['passkey-A'])
    mocks.logout.mockResolvedValue(undefined)
})

afterEach(function () {
    queryClient.clear()
    vi.restoreAllMocks()
})

describe('Logout cache boundary', function () {
    it('clears the cache before logout navigation', async function () {
        mocks.navigate.mockImplementation(async function () {
            expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
        })
        useAuthenticatedSidebarLogic().handler.handleLogout()
        await Promise.all(promises)
        expect(mocks.navigate).toHaveBeenCalledTimes(1)
        expect(mocks.resetTheme).toHaveBeenCalledTimes(1)
    })

    it('keeps cached data after a failed logout', async function () {
        mocks.logout.mockRejectedValue(new Error('synthetic-logout-failure'))
        useAuthenticatedSidebarLogic().handler.handleLogout()
        await Promise.all(promises)
        expect(
            queryClient.getQueryData<Array<string>>(['notifications']),
        ).toEqual(['private-marker-A'])
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.appError).toHaveBeenCalledTimes(1)
    })
})
