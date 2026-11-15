import {
    MutationObserver,
    dehydrate,
    timeoutManager,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { getContext } from '@/integrations/TanstackQuery/root-provider.ts'
import { flushSessionActivityTasks } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'

let queryClient = getContext().queryClient
const timers = new Map<number, number>()
let nextTimer = 0

beforeEach(function () {
    timers.clear()
    nextTimer = 0
    vi.spyOn(timeoutManager, 'setTimeout').mockImplementation(
        function (_callback, delay) {
            const id = ++nextTimer
            timers.set(id, delay)
            return id
        },
    )
    vi.spyOn(timeoutManager, 'clearTimeout').mockImplementation(function (id) {
        if (typeof id === 'number') timers.delete(id)
    })
    queryClient = getContext().queryClient
})

afterEach(function () {
    for (const mutation of queryClient.getMutationCache().getAll())
        mutation.destroy()
    queryClient.clear()
    timers.clear()
    vi.restoreAllMocks()
})

describe('application QueryClient authentication cleanup', function () {
    it.each([
        { outcome: 'success', unmount: false },
        { outcome: 'error', unmount: false },
        { outcome: 'success', unmount: true },
        { outcome: 'error', unmount: true },
    ] as const)(
        'releases marked $outcome data and observer state with unmount=$unmount',
        async function ({ outcome, unmount }) {
            const pending = Promise.withResolvers<string>()
            const variables = {
                password: 'synthetic-password-fixture',
                twoFactorCode: '123456',
            }
            const observer = new MutationObserver(queryClient, {
                gcTime: 300_000,
                meta: { discardAuthSecretsAfterSettled: true },
                mutationFn: async function (input: typeof variables) {
                    expect(input === variables).toBe(true)
                    return await pending.promise
                },
                onSettled() {
                    observer.reset()
                },
            })
            const unsubscribe = observer.subscribe(function () {})
            const result = observer.mutate(variables).catch(() => 'rejected')
            await flushSessionActivityTasks()
            const cache = queryClient.getMutationCache()

            expect(cache.getAll()).toHaveLength(1)
            expect(cache.getAll()[0]?.state.status).toBe('pending')
            expect(cache.getAll()[0]?.state.variables === variables).toBe(true)
            if (unmount) {
                unsubscribe()
                expect([...timers.values()]).toEqual([300_000])
            }

            if (outcome === 'success') pending.resolve('synthetic-proof-result')
            else pending.reject(new Error('synthetic-proof-error'))
            await result

            expect(cache.getAll()).toHaveLength(0)
            const current = observer.getCurrentResult()
            expect(current.status).toBe('idle')
            expect(current.variables).toBeUndefined()
            expect(current.data).toBeUndefined()
            expect(current.error).toBeNull()
            expect(timers.size).toBe(0)
            const serialized = JSON.stringify(
                dehydrate(queryClient, { shouldDehydrateMutation: () => true }),
            )
            expect(serialized.includes(variables.password)).toBe(false)
            expect(serialized.includes(variables.twoFactorCode)).toBe(false)
            expect(serialized.includes('synthetic-proof')).toBe(false)
            unsubscribe()
        },
    )

    it.each([undefined, false])(
        'keeps ordinary mutations when the marker is %s',
        async function (discardAuthSecretsAfterSettled) {
            const observer = new MutationObserver(queryClient, {
                gcTime: 300_000,
                meta:
                    discardAuthSecretsAfterSettled === undefined
                        ? undefined
                        : { discardAuthSecretsAfterSettled },
                mutationFn: async () => ({ saved: true }),
            })
            const unsubscribe = observer.subscribe(function () {})
            await observer.mutate()
            unsubscribe()

            expect(queryClient.getMutationCache().getAll()).toHaveLength(1)
            expect(observer.getCurrentResult().data).toEqual({ saved: true })
            expect([...timers.values()]).toEqual([300_000])
        },
    )

    it('keeps existing query and mutation defaults', function () {
        expect(queryClient.getDefaultOptions()).toEqual({
            queries: {
                staleTime: 30_000,
                gcTime: 10 * 60_000,
                retry: 1,
                refetchOnWindowFocus: false,
            },
            mutations: { retry: 0 },
        })
    })
})
