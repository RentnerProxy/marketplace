import * as React from 'react'
import * as Query from '@tanstack/react-query'
import { vi } from 'bun:test'

type MutationOptions = {
    mutationFn: (value: never) => Promise<unknown>
    onSuccess?: (result: never, value: never) => unknown
    onError?: (error: unknown) => unknown
}

const cells: Array<unknown> = []
const refs: Array<{ current: unknown }> = []
const mutations: Array<{ pending: boolean }> = []
let cursor = 0
let refCursor = 0
let mutationCursor = 0
let effectCursor = 0
const effects: Array<{
    dependencies?: ReadonlyArray<unknown>
    cleanup?: () => void
}> = []
const pendingEffects: Array<() => void> = []
const tasks: Array<Promise<unknown>> = []
export const client = new Query.QueryClient()
export const success = vi.fn()
export const error = vi.fn()
export const appError = vi.fn()
export const query = vi.fn((_options: unknown): Record<string, unknown> => ({}))

vi.mock('react', () => ({
    ...React,
    useState(initial: unknown) {
        const index = cursor++
        if (!(index in cells))
            cells[index] = typeof initial === 'function' ? initial() : initial
        return [
            cells[index],
            (value: unknown) => {
                cells[index] =
                    typeof value === 'function' ? value(cells[index]) : value
            },
        ]
    },
    useRef(initial: unknown) {
        return (refs[refCursor++] ??= { current: initial })
    },
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useEffect(effect: () => unknown, dependencies?: ReadonlyArray<unknown>) {
        const index = effectCursor++
        const previous = effects[index]
        if (
            previous &&
            dependencies &&
            dependencies.every((value, offset) =>
                Object.is(value, previous.dependencies?.[offset]),
            )
        )
            return
        pendingEffects.push(() => {
            previous?.cleanup?.()
            const dispose = effect()
            effects[index] = {
                dependencies,
                cleanup:
                    typeof dispose === 'function'
                        ? (dispose as () => void)
                        : undefined,
            }
        })
    },
}))
vi.mock('@tanstack/react-query', () => ({
    ...Query,
    useQuery: query,
    useQueryClient: () => client,
    useMutation(options: MutationOptions) {
        const state = (mutations[mutationCursor++] ??= { pending: false })
        return {
            isPending: state.pending,
            mutate(value: never) {
                state.pending = true
                tasks.push(
                    Promise.resolve()
                        .then(() => options.mutationFn(value))
                        .then((result) =>
                            options.onSuccess?.(result as never, value),
                        )
                        .catch((reason: unknown) => options.onError?.(reason))
                        .finally(() => {
                            state.pending = false
                        }),
                )
            },
        }
    },
}))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({ toastAppError: appError }))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language: 'de', t: (key: string) => key }),
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    ADMIN_SYSTEM_SETTINGS_QUERY_KEY: ['system-settings', 'admin'],
    authenticatedSessionQueryOptions: () => ({ queryKey: ['session'] }),
}))

export function render<T>(hook: () => T): T {
    cursor = 0
    refCursor = 0
    mutationCursor = 0
    effectCursor = 0
    const result = hook()
    for (const effect of pendingEffects.splice(0)) effect()
    return result
}

export async function settle() {
    await Promise.all(tasks.splice(0))
}

export function cleanup() {
    for (const effect of effects) effect.cleanup?.()
    effects.length = 0
    pendingEffects.length = 0
}

export function reset() {
    cleanup()
    vi.clearAllMocks()
    client.clear()
    cells.length = 0
    refs.length = 0
    mutations.length = 0
    tasks.length = 0
}
