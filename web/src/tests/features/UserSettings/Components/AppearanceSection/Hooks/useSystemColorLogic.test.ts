import { beforeEach, expect, mock, test } from 'bun:test'
import * as React from 'react'

const realReact = { ...React }
let values: unknown[] = []
let cursor = 0
let needsRender = false
let mutationCalls = 0
let requests: string[] = []
let session = { user: { id: 'first-user', primaryColor: '#abcdef' } }
interface MutationConfig {
    mutationFn: () => Promise<unknown>
    onSuccess?: (result: { success: true; primaryColor: string }) => void
}
let configs: MutationConfig[] = []
mock.module('react', () => ({
    ...realReact,
    useMemo: (factory: () => unknown) => factory(),
    useState: <T>(initial: T | (() => T)) => {
        const index = cursor++
        if (!(index in values))
            values[index] =
                typeof initial === 'function' ? (initial as () => T)() : initial
        return [
            values[index] as T,
            (next: T | ((current: T) => T)) => {
                const value =
                    typeof next === 'function'
                        ? (next as (current: T) => T)(values[index] as T)
                        : next
                if (!Object.is(values[index], value)) {
                    values[index] = value
                    needsRender = true
                }
            },
        ] as const
    },
}))
mock.module('@tanstack/react-query', () => ({
    useQuery: () => ({ data: session }),
    useQueryClient: () => ({ setQueryData: () => undefined }),
    useMutation: (config: MutationConfig) => {
        configs.push(config)
        return {
            isPending: false,
            mutate: () => {
                mutationCalls += 1
            },
        }
    },
}))
mock.module('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['test-session'] }),
}))
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/toasts', () => ({
    toast: { success: () => undefined, error: () => undefined },
}))
mock.module('@rentnerkev/toasts/toast', () => ({
    toast: { success: () => undefined, error: () => undefined },
}))
mock.module('@/lib/Errors/appError.ts', () => ({ AppError: Error }))
mock.module('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: () => undefined,
}))
mock.module('@/lib/UserSettings/sessionCache.ts', () => ({
    updateAuthenticatedSessionUserCache: () => undefined,
}))
mock.module('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserPrimaryColorHandler: async ({
        data,
    }: {
        data: { primaryColor: string }
    }) => {
        requests.push(data.primaryColor)
        return { success: true, primaryColor: data.primaryColor }
    },
    resetCurrentUserPrimaryColorHandler: async () => ({
        success: true,
        primaryColor: '#abcdef',
    }),
}))
const { default: useSystemColorLogic } =
    await import('@/features/UserSettings/Components/AppearanceSection/Hooks/useSystemColorLogic.ts')
function Probe() {
    return useSystemColorLogic()
}
function render() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        cursor = 0
        configs = []
        needsRender = false
        const result = Probe()
        if (!needsRender) return result
    }
    throw new Error('Hook did not settle')
}
beforeEach(() => {
    values = []
    cursor = 0
    mutationCalls = 0
    requests = []
    session = { user: { id: 'first-user', primaryColor: '#abcdef' } }
})
test('blocks invalid visible drafts and resets an unchanged controlled color', () => {
    let api = render()
    api.handler.handlePrimaryColorValidityChange(false)
    api = render()
    api.handler.handleSavePrimaryColor()
    expect(mutationCalls).toBe(0)
    expect(api.state.isPrimaryColorValid).toBe(false)
    const previousKey = api.state.primaryColorResetKey
    configs[1]!.onSuccess?.({ success: true, primaryColor: '#abcdef' })
    api = render()
    expect(api.state.selectedPrimaryColor).toBe('#abcdef')
    expect(api.state.isPrimaryColorValid).toBe(true)
    expect(api.state.primaryColorResetKey).toBeGreaterThan(previousKey)
})
test('resets an invalid draft on a different session with the same color', () => {
    let api = render()
    api.handler.handlePrimaryColorValidityChange(false)
    api = render()
    const previousKey = api.state.primaryColorResetKey
    session = { user: { id: 'next-user', primaryColor: '#abcdef' } }
    api = render()
    expect(api.state.isPrimaryColorValid).toBe(true)
    expect(api.state.primaryColorResetKey).toBeGreaterThan(previousKey)
})
