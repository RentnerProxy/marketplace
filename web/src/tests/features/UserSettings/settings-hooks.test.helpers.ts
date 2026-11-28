import * as React from 'react'
import * as Query from '@tanstack/react-query'
import { vi } from 'bun:test'
import type { AppLanguage } from '@/shared/Types/config.types.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'

const react = { ...React }
const queryExports = { ...Query }
const cells: unknown[] = []
const pending: Array<Promise<unknown>> = []
const mutations: Array<{
    isPending: boolean
    mutationKey?: Query.MutationKey
}> = []
let stateCursor = 0
let mutationCursor = 0

export const client = new Query.QueryClient()
export const success = vi.fn()
export const failure = vi.fn()
export const query = vi.fn((_options: unknown): { data: unknown } => ({
    data: undefined,
}))
export const setLanguage = vi.fn(async (_language: AppLanguage) => {})
export const translation = {
    language: 'de' as AppLanguage,
    availableLanguages: ['de', 'en'],
    setLanguage,
    t: (key: string) => key,
}

vi.mock('react', () => ({
    ...react,
    useState<T>(initial: T | (() => T)) {
        const index = stateCursor++
        if (!(index in cells)) {
            cells[index] =
                typeof initial === 'function' ? (initial as () => T)() : initial
        }
        return [
            cells[index],
            (value: T | ((previous: T) => T)) => {
                cells[index] =
                    typeof value === 'function'
                        ? (value as (previous: unknown) => unknown)(
                              cells[index],
                          )
                        : value
            },
        ]
    },
}))
vi.mock('@tanstack/react-query', () => ({
    ...queryExports,
    useQuery: query,
    useQueryClient: () => client,
    useIsMutating({ mutationKey }: Query.MutationFilters) {
        return mutations.filter(
            (mutation) =>
                mutation.isPending && mutation.mutationKey === mutationKey,
        ).length
    },
    useMutation<TData, TVariables>(options: {
        mutationKey?: Query.MutationKey
        mutationFn: (variables: TVariables) => Promise<TData>
        onSuccess?: (result: TData) => unknown
        onError?: (error: unknown) => unknown
    }) {
        const state = (mutations[mutationCursor++] ??= {
            isPending: false,
            mutationKey: options.mutationKey,
        })
        return {
            isPending: state.isPending,
            mutate(variables: TVariables) {
                state.isPending = true
                pending.push(
                    (async function () {
                        try {
                            const result = await options.mutationFn(variables)
                            await options.onSuccess?.(result)
                        } catch (error) {
                            await options.onError?.(error)
                        } finally {
                            state.isPending = false
                        }
                    })(),
                )
            },
        }
    },
}))
vi.mock('@rentnerkev/toasts', () => ({
    toast: { success, error: failure },
}))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: failure,
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => translation,
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['session'] }),
    ADMIN_SYSTEM_SETTINGS_QUERY_KEY: ['admin-system-settings'],
}))

export function render<T>(hook: () => T): T {
    stateCursor = 0
    mutationCursor = 0
    return hook()
}

export async function settle() {
    await Promise.all(pending.splice(0))
}

export function reset() {
    vi.clearAllMocks()
    cells.length = 0
    mutations.length = 0
    pending.length = 0
    client.clear()
    translation.language = 'de'
    setLanguage.mockReset().mockResolvedValue(undefined)
    query.mockReturnValue({ data: undefined })
}

export function createSession(): AuthenticatedSessionQueryData {
    return {
        permissions: ['user.profile'],
        user: {
            id: 'member-1',
            username: 'tester',
            fontFamily: 'inter',
            fontSize: 16,
            themeMode: 'dark',
            bio: null,
            primaryColor: null,
            profileImageVersion: 4,
            customBackgroundDarkness: null,
            customBackgroundUpdatedAt: null,
        },
    }
}
