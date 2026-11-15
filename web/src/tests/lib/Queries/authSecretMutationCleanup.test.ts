import {
    MutationCache,
    MutationObserver,
    QueryClient,
    timeoutManager,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { installAuthSecretMutationCleanup } from '@/lib/Queries/authSecretMutationCleanup.ts'
import { flushSessionActivityTasks } from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'

const timers = new Map<number, { callback: () => void; delay: number }>()
let queryClient: QueryClient
let nextTimer = 0

beforeEach(function () {
    timers.clear()
    nextTimer = 0
    vi.spyOn(timeoutManager, 'setTimeout').mockImplementation(
        function (callback, delay) {
            const id = ++nextTimer
            timers.set(id, { callback, delay })
            return id
        },
    )
    vi.spyOn(timeoutManager, 'clearTimeout').mockImplementation(function (id) {
        if (typeof id === 'number') timers.delete(id)
    })
    queryClient = new QueryClient({
        defaultOptions: { mutations: { gcTime: 300_000, retry: false } },
    })
})

afterEach(function () {
    for (const mutation of queryClient.getMutationCache().getAll())
        mutation.destroy()
    queryClient.clear()
    timers.clear()
    vi.restoreAllMocks()
})

describe('Secret-bearing authentication mutation cache cleanup', function () {
    it.each(['success', 'error'] as const)(
        'discards the settled %s closure and timer after the panel unmounted while pending',
        async function (outcome) {
            installAuthSecretMutationCleanup(queryClient)
            const pending = Promise.withResolvers<string>()
            const capturedProof = 'synthetic-authentication-proof'
            const observer = new MutationObserver(queryClient, {
                meta: { discardAuthSecretsAfterSettled: true },
                mutationFn: async function () {
                    expect(capturedProof).toBe('synthetic-authentication-proof')
                    return await pending.promise
                },
                onSettled() {
                    observer.reset()
                },
            })
            const unsubscribe = observer.subscribe(function () {})
            const result = observer
                .mutate()
                .catch(() => 'expected synthetic failure')
            await flushSessionActivityTasks()
            const cache = queryClient.getMutationCache()
            const original = cache.getAll()[0]
            expect(original?.options.mutationFn).toBeDefined()
            expect(original?.state.status).toBe('pending')
            unsubscribe()
            expect(cache.getAll()).toHaveLength(1)
            expect([...timers.values()].map((timer) => timer.delay)).toEqual([
                300_000,
            ])
            if (outcome === 'success') pending.resolve('saved')
            else pending.reject(new Error('synthetic request failure'))
            expect(await result).toBe(
                outcome === 'success' ? 'saved' : 'expected synthetic failure',
            )
            observer.setOptions({ mutationFn: async () => 'next request' })
            expect(observer.getCurrentResult().status).toBe('idle')
            expect(observer.getCurrentResult().data).toBeUndefined()
            expect(cache.getAll()).toHaveLength(0)
            expect(cache.getAll()).not.toContain(original)
            expect(timers.size).toBe(0)
        },
    )

    it('installs one listener per cache even when two clients share it', function () {
        const cache = new MutationCache()
        const first = new QueryClient({ mutationCache: cache })
        const second = new QueryClient({ mutationCache: cache })
        const subscribe = vi.spyOn(cache, 'subscribe')
        for (let index = 0; index < 10; index += 1) {
            installAuthSecretMutationCleanup(first)
            installAuthSecretMutationCleanup(second)
        }
        expect(subscribe).toHaveBeenCalledTimes(1)
    })

    it('retains an unmarked mutation and its ordinary GC timer', async function () {
        installAuthSecretMutationCleanup(queryClient)
        const observer = new MutationObserver(queryClient, {
            meta: { discardAuthSecretsAfterSettled: false },
            mutationFn: async () => 'ordinary result',
        })
        const unsubscribe = observer.subscribe(function () {})
        await observer.mutate()
        unsubscribe()
        const cache = queryClient.getMutationCache()
        expect(cache.getAll()).toHaveLength(1)
        expect(cache.getAll()[0]?.state.data).toBe('ordinary result')
        expect([...timers.values()].map((timer) => timer.delay)).toEqual([
            300_000,
        ])
    })
})
