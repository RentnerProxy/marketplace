import { beforeEach, describe, expect, it, vi } from 'bun:test'

const closePools = vi.fn<() => Promise<void>>()
const closeWrites = vi.fn<() => Promise<void>>()
const closeConnections = vi.fn<() => Promise<void>>()
vi.mock('@/server/Runtime/app-connections.service.ts', () => ({
    closeAppConnectionsService: closeConnections,
}))
vi.mock('@/server/Core/worker-pool.service.ts', () => ({
    closeCoreWorkerPoolsService: closePools,
}))
vi.mock('@/server/Storage/private-write-queue.service.ts', () => ({
    closePrivateStorageWritesService: closeWrites,
}))
const { default: coreWorkerLifecycleService } =
    await import('@/server/Runtime/core-worker-lifecycle.service.ts')

beforeEach(function () {
    vi.clearAllMocks()
    closeWrites.mockResolvedValue(undefined)
    closeConnections.mockResolvedValue(undefined)
})

describe('Core-Worker-Lebenszyklus', function () {
    it('wartet erst beim Nitro-Close-Hook auf die vollständige Pool-Bereinigung', async function () {
        const cleanup = Promise.withResolvers<void>()
        const writes = Promise.withResolvers<void>()
        closeWrites.mockReturnValue(writes.promise)
        closePools.mockReturnValue(cleanup.promise)
        const hook = vi.fn()
        await coreWorkerLifecycleService({
            fetch: () => new Response(),
            hooks: {
                hook,
                removeHook: vi.fn(),
                callHook: vi.fn(async () => undefined),
            },
        } as Parameters<typeof coreWorkerLifecycleService>[0])

        expect(closePools).not.toHaveBeenCalled()
        expect(closeConnections).not.toHaveBeenCalled()
        expect(hook).toHaveBeenCalledTimes(1)
        expect(hook.mock.calls[0]?.[0]).toBe('close')
        const onClose = hook.mock.calls[0]![1] as () => Promise<void>
        const closing = onClose()
        expect(closeWrites).toHaveBeenCalledTimes(1)
        expect(closePools).not.toHaveBeenCalled()
        writes.resolve()
        await Promise.resolve()
        expect(closePools).toHaveBeenCalledTimes(1)
        cleanup.resolve()
        await closing
        expect(closeConnections).toHaveBeenCalledTimes(1)
    })
    it('räumt Core-Pools auch nach einem fehlgeschlagenen Write-Drain auf', async function () {
        const failure = new Error('drain failed')
        closeWrites.mockRejectedValueOnce(failure)
        closePools.mockResolvedValueOnce(undefined)
        const hook = vi.fn()
        await coreWorkerLifecycleService({
            fetch: () => new Response(),
            hooks: {
                hook,
                removeHook: vi.fn(),
                callHook: vi.fn(async () => undefined),
            },
        } as Parameters<typeof coreWorkerLifecycleService>[0])
        const onClose = hook.mock.calls[0]![1] as () => Promise<void>
        await expect(onClose()).rejects.toBe(failure)
        expect(closePools).toHaveBeenCalledTimes(1)
        expect(closeConnections).toHaveBeenCalledTimes(1)
    })

    it('schließt App-Verbindungen auch nach einem fehlgeschlagenen Core-Drain', async function () {
        const failure = new Error('pool drain failed')
        closePools.mockRejectedValueOnce(failure)
        const hook = vi.fn()
        await coreWorkerLifecycleService({
            fetch: () => new Response(),
            hooks: { hook },
        } as unknown as Parameters<typeof coreWorkerLifecycleService>[0])
        const onClose = hook.mock.calls[0]![1] as () => Promise<void>
        await expect(onClose()).rejects.toBe(failure)
        expect(closeConnections).toHaveBeenCalledTimes(1)
    })
})
