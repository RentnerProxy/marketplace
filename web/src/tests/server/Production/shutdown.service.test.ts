import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { WORKER_SHUTDOWN } from '@/config/health.config.ts'
import { shutdownProductionServerService } from '@/server/Production/shutdown.service.ts'

const closeConnections = vi.fn<() => Promise<void>>()
const closePools = vi.fn<() => Promise<void>>()
const releaseIdleLease = vi.fn(async () => undefined)
const logError = vi.fn()
const logWarn = vi.fn()
vi.mock('@/server/Runtime/app-connections.service.ts', () => ({
    closeAppConnectionsService: closeConnections,
}))
vi.mock('@/server/Core/worker-pool.service.ts', () => ({
    closeCoreWorkerPoolsService: closePools,
}))
vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
    drainSharedStorageMutationBarrierService: releaseIdleLease,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logError, logWarn }))

function createOptions() {
    return {
        server: {
            pendingRequests: 0,
            stop: vi.fn(async function (_force?: boolean) {}),
        },
        appProcess: {
            kill: vi.fn(function (_signal: 'SIGINT' | 'SIGTERM') {}),
            exited: Promise.resolve(0),
        },
        subscriber: {
            status: 'ready',
            quit: vi.fn(async () => 'OK'),
            disconnect: vi.fn(function () {}),
        },
        stopSetupLog: vi.fn(function () {}),
    }
}

async function flushPromises() {
    let pending = Promise.resolve()
    for (let index = 0; index < 30; index += 1) {
        pending = pending.then(() => undefined)
    }
    await pending
}

beforeEach(function () {
    vi.useFakeTimers()
    vi.clearAllMocks()
    closeConnections.mockResolvedValue(undefined)
    closePools.mockResolvedValue(undefined)
})

afterEach(function () {
    vi.useRealTimers()
})

describe('Produktions-Webserver-Shutdown', function () {
    it.each(['SIGTERM', 'SIGINT'] as const)(
        'schließt im Leerlauf ohne feste Wartefrist und reicht %s weiter',
        async function (signal) {
            const options = createOptions()
            const started = Date.now()
            expect(await shutdownProductionServerService(options, signal)).toBe(
                0,
            )
            expect(Date.now()).toBe(started)
            expect(options.stopSetupLog).toHaveBeenCalledTimes(1)
            expect(options.server.stop).toHaveBeenCalledWith(true)
            expect(options.appProcess.kill).toHaveBeenCalledWith(signal)
            expect(options.subscriber.quit).toHaveBeenCalledTimes(1)
            expect(closeConnections).toHaveBeenCalledTimes(1)
            expect(vi.getTimerCount()).toBe(0)
        },
    )

    it('reicht das Signal trotz hängendem Proxy weiter und wartet uneingeschränkt auf den App-Drain', async function () {
        const options = createOptions()
        const server = Promise.withResolvers<void>()
        const app = Promise.withResolvers<number>()
        options.server.stop.mockReturnValueOnce(server.promise)
        options.appProcess.exited = app.promise
        const stopping = shutdownProductionServerService(options, 'SIGTERM')
        let finished = false
        const outcome = stopping.then(function (code) {
            finished = true
            return code
        })
        expect(options.appProcess.kill).toHaveBeenCalledWith('SIGTERM')
        await flushPromises()
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs)
        await flushPromises()
        expect(logWarn).toHaveBeenCalledWith(
            'production.shutdown_server_timeout',
        )
        vi.advanceTimersByTime(60 * 60_000)
        await flushPromises()
        expect(finished).toBe(false)
        expect(options.subscriber.quit).not.toHaveBeenCalled()
        expect(closeConnections).not.toHaveBeenCalled()
        expect(closePools).not.toHaveBeenCalled()
        expect(options.appProcess.kill).toHaveBeenCalledTimes(1)
        app.resolve(0)
        expect(await outcome).toBe(1)
        server.reject(new Error('late synthetic stop failure'))
        await flushPromises()
        expect(closeConnections).toHaveBeenCalledTimes(1)
        expect(closePools).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps active HTTP requests open through the app drain and closes Core after the proxy drains', async function () {
        const options = createOptions()
        const proxy = Promise.withResolvers<void>()
        const app = Promise.withResolvers<number>()
        const pools = Promise.withResolvers<void>()
        options.server.pendingRequests = 1
        options.server.stop.mockReturnValueOnce(proxy.promise)
        options.appProcess.exited = app.promise
        closePools.mockReturnValueOnce(pools.promise)

        const stopping = shutdownProductionServerService(options, 'SIGTERM')
        await flushPromises()
        expect(options.server.stop.mock.calls).toEqual([[false]])
        expect(options.appProcess.kill).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(60_000)
        app.resolve(0)
        await flushPromises()
        expect(closePools).not.toHaveBeenCalled()
        proxy.resolve()
        await flushPromises()
        expect(closePools).toHaveBeenCalledTimes(1)
        expect(closeConnections).not.toHaveBeenCalled()
        pools.resolve()
        await expect(stopping).resolves.toBe(0)
        expect(options.server.stop.mock.calls).toEqual([[false]])
        expect(closeConnections).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('führt den App-Drain und weitere Bereinigung trotz synchroner Fehler aus', async function () {
        const options = createOptions()
        options.stopSetupLog.mockImplementationOnce(function () {
            throw new Error('setup stop')
        })
        options.server.stop.mockImplementationOnce(function () {
            throw new Error('server stop')
        })
        options.appProcess.kill.mockImplementationOnce(function () {
            throw new Error('signal')
        })
        const app = Promise.withResolvers<number>()
        options.appProcess.exited = app.promise
        const stopping = shutdownProductionServerService(options, 'SIGTERM')
        await flushPromises()
        expect(closeConnections).not.toHaveBeenCalled()
        app.resolve(0)
        expect(await stopping).toBe(1)
        expect(options.subscriber.quit).toHaveBeenCalledTimes(1)
        expect(closeConnections).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('meldet einen fehlgeschlagenen App-Prozess nach vollständiger Bereinigung', async function () {
        const options = createOptions()
        options.appProcess.exited = Promise.resolve(23)
        expect(await shutdownProductionServerService(options, 'SIGTERM')).toBe(
            1,
        )
        expect(logWarn).toHaveBeenCalledWith('production.shutdown_app_failed')
        expect(closeConnections).toHaveBeenCalledTimes(1)
    })

    it('begrenzt einen hängenden Subscriber und trennt erst nach dem App-Drain', async function () {
        const options = createOptions()
        const subscriber = Promise.withResolvers<string>()
        options.subscriber.quit.mockReturnValueOnce(subscriber.promise)
        const stopping = shutdownProductionServerService(options, 'SIGTERM')
        await flushPromises()
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs)
        expect(await stopping).toBe(1)
        expect(options.subscriber.disconnect).toHaveBeenCalledTimes(1)
        expect(closeConnections).toHaveBeenCalledTimes(1)
        subscriber.resolve('OK')
        expect(vi.getTimerCount()).toBe(0)
    })

    it('räumt nach Subscriber- und Verbindungsfehlern weiter auf', async function () {
        const options = createOptions()
        options.subscriber.quit.mockRejectedValueOnce(new Error('quit'))
        options.subscriber.disconnect.mockImplementationOnce(function () {
            throw new Error('disconnect')
        })
        closeConnections.mockRejectedValueOnce(new Error('close connections'))
        closePools.mockRejectedValueOnce(new Error('close Core worker pools'))
        expect(await shutdownProductionServerService(options, 'SIGTERM')).toBe(
            1,
        )
        expect(closeConnections).toHaveBeenCalledTimes(1)
        expect(logError).toHaveBeenCalledWith(
            'production.shutdown_core_pools_failed',
            expect.any(Error),
        )
        expect(logError).toHaveBeenCalledWith(
            'production.shutdown_connections_failed',
            expect.any(Error),
        )
    })

    it('trennt einen reconnectenden Subscriber sofort und benötigt keinen Subscriber', async function () {
        const options = createOptions()
        options.subscriber.status = 'reconnecting'
        expect(await shutdownProductionServerService(options, 'SIGTERM')).toBe(
            0,
        )
        expect(options.subscriber.quit).not.toHaveBeenCalled()
        expect(options.subscriber.disconnect).toHaveBeenCalledTimes(1)
        expect(
            await shutdownProductionServerService(
                { ...createOptions(), subscriber: null },
                'SIGTERM',
            ),
        ).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
    })
})
