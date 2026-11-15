import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { WORKER_SHUTDOWN } from '@/config/health.config.ts'
import { createQueueWorkerLifecycleService } from '@/server/Runtime/queue-worker-lifecycle.service.ts'

const logInfo = vi.fn()
const logWarn = vi.fn()
vi.mock('@/server/Logging/logger.ts', () => ({ logInfo, logWarn }))

async function flushPromises() {
    let pending = Promise.resolve()
    for (let index = 0; index < 20; index += 1) {
        pending = pending.then(() => undefined)
    }
    await pending
}

beforeEach(function () {
    vi.useFakeTimers()
    vi.clearAllMocks()
})

afterEach(function () {
    vi.useRealTimers()
})

describe('Queue-Worker-Shutdown', function () {
    it('beendet einen untätigen Worker sofort und behandelt wiederholte Stopps nur einmal', async function () {
        const worker = {
            close: vi.fn(async function () {}),
            disconnect: vi.fn(async function () {}),
        }
        const lifecycle = createQueueWorkerLifecycleService('backups')
        const closing = lifecycle.close(worker)
        expect(lifecycle.close(worker)).toBe(closing)
        await closing
        expect(worker.close).toHaveBeenCalledTimes(1)
        expect(worker.disconnect).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('wartet auch bei ausgefallenem Valkey unbegrenzt auf einen aktiven Restore und trennt erst danach Queue-Sockets', async function () {
        const jobFinished = Promise.withResolvers<string>()
        const queueClosed = Promise.withResolvers<void>()
        const worker = {
            close: vi.fn(() => queueClosed.promise),
            disconnect: vi.fn(async function () {}),
        }
        const lifecycle = createQueueWorkerLifecycleService('backups')
        const job = lifecycle.runJob(() => jobFinished.promise)
        const closing = lifecycle.close(worker)
        const completed = vi.fn()
        void closing.then(completed)

        vi.advanceTimersByTime(5 * 60_000)
        await flushPromises()
        expect(completed).not.toHaveBeenCalled()
        expect(worker.disconnect).not.toHaveBeenCalled()
        expect(logInfo).toHaveBeenCalledWith('queue.worker.shutdown_waiting', {
            queueName: 'backups',
            count: 1,
        })

        jobFinished.resolve('restore-completed')
        await expect(job).resolves.toBe('restore-completed')
        await flushPromises()
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs - 1)
        await flushPromises()
        expect(worker.disconnect).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        await closing
        expect(worker.disconnect).toHaveBeenCalledTimes(1)
        expect(logWarn).toHaveBeenCalledWith(
            'queue.worker.shutdown_disconnect',
            {
                queueName: 'backups',
            },
        )
        queueClosed.resolve()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('erzwingt keinen Disconnect für einen Processor, der während des technischen Close-Wartens startet', async function () {
        const queueClosed = Promise.withResolvers<void>()
        const jobFinished = Promise.withResolvers<void>()
        const worker = {
            close: vi.fn(() => queueClosed.promise),
            disconnect: vi.fn(async function () {}),
        }
        const lifecycle = createQueueWorkerLifecycleService('backups')
        const closing = lifecycle.close(worker)
        await flushPromises()
        const job = lifecycle.runJob(() => jobFinished.promise)

        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs * 3)
        await flushPromises()
        expect(worker.disconnect).not.toHaveBeenCalled()
        jobFinished.resolve()
        await job
        queueClosed.resolve()
        await closing
        expect(worker.disconnect).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('wartet trotz fehlgeschlagenem Queue-Close auf den Processor und erhält seinen ursprünglichen Fehler', async function () {
        const jobFinished = Promise.withResolvers<void>()
        const jobError = new Error('Synthetic processor failure')
        const closeError = new Error('Synthetic close failure')
        const worker = {
            close: vi.fn(async function () {
                throw closeError
            }),
            disconnect: vi.fn(async function () {}),
        }
        const lifecycle = createQueueWorkerLifecycleService(
            'rentnerproxy-marketplace-mail-v2',
        )
        const job = lifecycle.runJob(() => jobFinished.promise)
        const jobOutcome = job.catch((error: unknown) => error)
        const closing = lifecycle.close(worker)
        const closeOutcome = closing.catch((error: unknown) => error)
        const completed = vi.fn()
        void closeOutcome.then(completed)
        await flushPromises()
        expect(completed).not.toHaveBeenCalled()

        jobFinished.reject(jobError)
        await expect(jobOutcome).resolves.toBe(jobError)
        await expect(closeOutcome).resolves.toBe(closeError)
        expect(worker.disconnect).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('begrenzt auch einen hängenden Socket-Disconnect nach abgeschlossenen Jobs', async function () {
        const queueClosed = Promise.withResolvers<void>()
        const disconnected = Promise.withResolvers<void>()
        const worker = {
            close: vi.fn(() => queueClosed.promise),
            disconnect: vi.fn(() => disconnected.promise),
        }
        const closing =
            createQueueWorkerLifecycleService('backups').close(worker)
        const outcome = closing.catch((error: unknown) => error)
        await flushPromises()
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs)
        await flushPromises()
        expect(worker.disconnect).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs)
        await expect(outcome).resolves.toBeInstanceOf(Error)
        queueClosed.resolve()
        disconnected.resolve()
        expect(vi.getTimerCount()).toBe(0)
    })
})
