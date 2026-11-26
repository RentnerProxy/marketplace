import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { WORKER_SHUTDOWN } from '@/config/health.config.ts'
import { createWorkerShutdownService } from '@/server/Runtime/worker-shutdown.service.ts'

const logError = vi.fn()
const logInfo = vi.fn()
const logWarn = vi.fn()
vi.mock('@/server/Logging/logger.ts', () => ({ logError, logInfo, logWarn }))

async function flushPromises() {
    let pending = Promise.resolve()
    for (let index = 0; index < 20; index += 1) {
        pending = pending.then(() => undefined)
    }
    await pending
}

beforeEach(function () {
    vi.clearAllMocks()
    vi.useFakeTimers()
})

afterEach(function () {
    vi.useRealTimers()
})

describe('Background-Worker-Shutdown', function () {
    it('bricht den Start sofort ab, übernimmt entstehende Worker und führt den Shutdown nur einmal aus', async function () {
        const ready = Promise.withResolvers<void>()
        const order: string[] = []
        const shutdown = createWorkerShutdownService({
            ready: ready.promise,
            stopHeartbeat: async function () {
                order.push('heartbeat')
            },
            closeWorkers: async function () {
                order.push('workers')
            },
            stopStatus: async function () {
                order.push('status')
            },
            closeConnections: async function () {
                order.push('connections')
            },
        })
        const stopping = shutdown.shutdown()
        expect(shutdown.signal.aborted).toBe(true)
        expect(shutdown.shutdown()).toBe(stopping)
        await flushPromises()
        expect(order).toEqual([])
        ready.resolve()
        await expect(stopping).resolves.toBe(0)
        expect(order).toEqual(['heartbeat', 'workers', 'status', 'connections'])
        expect(logInfo).toHaveBeenCalledWith(
            'background_worker.shutdown_started',
        )
        expect(logInfo).toHaveBeenCalledWith(
            'background_worker.shutdown_completed',
            {
                durationMs: expect.any(Number),
                count: 0,
            },
        )
        expect(vi.getTimerCount()).toBe(0)
    })

    it('lässt einen hängenden Heartbeat nicht den Job-Abschluss und Status-Cleanup blockieren', async function () {
        const heartbeatStopped = Promise.withResolvers<void>()
        const jobsFinished = Promise.withResolvers<void>()
        const closeWorkers = vi.fn(() => jobsFinished.promise)
        const stopStatus = vi.fn(async function () {})
        const closeConnections = vi.fn(async function () {})
        const shutdown = createWorkerShutdownService({
            ready: Promise.resolve(),
            stopHeartbeat: () => heartbeatStopped.promise,
            closeWorkers,
            stopStatus,
            closeConnections,
        })
        const stopping = shutdown.shutdown()
        await flushPromises()
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs)
        await flushPromises()
        expect(closeWorkers).toHaveBeenCalledTimes(1)
        expect(logWarn).toHaveBeenCalledWith(
            'background_worker.shutdown_heartbeat_timeout',
        )
        vi.advanceTimersByTime(5 * 60_000)
        await flushPromises()
        expect(stopStatus).not.toHaveBeenCalled()
        expect(closeConnections).not.toHaveBeenCalled()
        jobsFinished.resolve()
        await expect(stopping).resolves.toBe(1)
        expect(stopStatus).toHaveBeenCalledTimes(1)
        expect(closeConnections).toHaveBeenCalledTimes(1)
        heartbeatStopped.resolve()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('führt nach Closefehlern weitere Cleanup-Schritte aus und meldet einen Fehler-Exitcode', async function () {
        const failure = new Error('Synthetic close failure')
        const stopStatus = vi.fn(async function () {})
        const shutdown = createWorkerShutdownService({
            ready: Promise.resolve(),
            stopHeartbeat: async function () {
                throw failure
            },
            closeWorkers: async function () {
                throw failure
            },
            stopStatus,
            closeConnections: async function () {
                throw failure
            },
        })
        await expect(shutdown.shutdown()).resolves.toBe(1)
        expect(stopStatus).toHaveBeenCalledTimes(1)
        expect(logError).toHaveBeenCalledWith(
            'background_worker.shutdown_heartbeat_failed',
            failure,
        )
        expect(logError).toHaveBeenCalledWith(
            'background_worker.shutdown_workers_failed',
            failure,
        )
        expect(logError).toHaveBeenCalledWith(
            'background_worker.shutdown_connections_failed',
            failure,
        )
        expect(logInfo).toHaveBeenCalledWith(
            'background_worker.shutdown_completed',
            {
                durationMs: expect.any(Number),
                count: 3,
            },
        )
        expect(vi.getTimerCount()).toBe(0)
    })

    it('begrenzt ein hängendes Status-Cleanup und behandelt spätere Fehler ohne erneuten Shutdown', async function () {
        const statusStopped = Promise.withResolvers<void>()
        const closeConnections = vi.fn(async function () {})
        const shutdown = createWorkerShutdownService({
            ready: Promise.resolve(),
            stopHeartbeat: async function () {},
            closeWorkers: async function () {},
            stopStatus: () => statusStopped.promise,
            closeConnections,
        })
        const stopping = shutdown.shutdown()
        await flushPromises()
        expect(closeConnections).not.toHaveBeenCalled()
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs)
        await expect(stopping).resolves.toBe(1)
        expect(closeConnections).toHaveBeenCalledTimes(1)
        expect(logWarn).toHaveBeenCalledWith(
            'background_worker.shutdown_status_timeout',
        )
        statusStopped.reject(new Error('Late synthetic cleanup failure'))
        await flushPromises()
        expect(shutdown.shutdown()).toBe(stopping)
        expect(vi.getTimerCount()).toBe(0)
    })
})
