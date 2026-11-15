import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { WORKER_SHUTDOWN } from '@/config/health.config.ts'
import { closeAppConnectionsService } from '@/server/Runtime/app-connections.service.ts'

const logWarn = vi.fn()
vi.mock('@/server/Logging/logger.ts', () => ({ logWarn }))

const names = [
    'appMailQueueV2',
    'appBackupQueue',
    'appValkeyConnection',
    'appValkeyPublisher',
] as const
const originalGlobals = names.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
)

function install(name: (typeof names)[number], value: object | undefined) {
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value,
    })
}

function createQueue() {
    return {
        close: vi.fn(async function () {}),
        disconnect: vi.fn(async function () {}),
    }
}

function createClient(status = 'ready') {
    return {
        status,
        quit: vi.fn(async () => 'OK'),
        disconnect: vi.fn(function () {}),
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
    for (const name of names) install(name, undefined)
})

afterEach(function () {
    for (const [index, name] of names.entries()) {
        const descriptor = originalGlobals[index]
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
    }
    vi.useRealTimers()
})

describe('Anwendungsverbindungen beim Shutdown', function () {
    it('erzeugt bei unbenutzten Verbindungen keine Ressourcen', async function () {
        await closeAppConnectionsService()
        for (const name of names) expect(globalThis[name]).toBeUndefined()
        expect(logWarn).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('schließt Producer vor Valkey, erhält Globals und schließt jede Ressource nur einmal', async function () {
        const queueClosed = Promise.withResolvers<void>()
        const mail = createQueue()
        mail.close.mockReturnValueOnce(queueClosed.promise)
        const backup = createQueue()
        const connection = createClient()
        const publisher = createClient()
        install('appMailQueueV2', mail)
        install('appBackupQueue', backup)
        install('appValkeyConnection', connection)
        install('appValkeyPublisher', publisher)

        const stopping = closeAppConnectionsService()
        const repeated = closeAppConnectionsService()
        await flushPromises()
        expect(mail.close).toHaveBeenCalledTimes(1)
        expect(backup.close).toHaveBeenCalledTimes(1)
        expect(connection.quit).not.toHaveBeenCalled()
        queueClosed.resolve()
        await Promise.all([stopping, repeated])
        await closeAppConnectionsService()
        expect(connection.quit).toHaveBeenCalledTimes(1)
        expect(publisher.quit).toHaveBeenCalledTimes(1)
        expect(connection.disconnect).not.toHaveBeenCalled()
        expect(Object.is(globalThis.appMailQueueV2, mail)).toBe(true)
        expect(Object.is(globalThis.appValkeyConnection, connection)).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    it.each(['wait', 'connecting', 'reconnecting', 'end'])(
        'trennt Valkey im Zustand %s sofort ohne QUIT',
        async function (status) {
            const connection = createClient(status)
            install('appValkeyConnection', connection)
            await closeAppConnectionsService()
            expect(connection.quit).not.toHaveBeenCalled()
            expect(connection.disconnect).toHaveBeenCalledTimes(1)
            expect(vi.getTimerCount()).toBe(0)
        },
    )

    it('trennt nach einem QUIT-Fehler und protokolliert keine Fehlerdaten', async function () {
        const connection = createClient()
        connection.quit.mockRejectedValueOnce(new Error('synthetic secret'))
        install('appValkeyConnection', connection)
        await closeAppConnectionsService()
        expect(connection.disconnect).toHaveBeenCalledTimes(1)
        expect(logWarn).toHaveBeenCalledWith(
            'runtime.connections.valkey_connection_quit_failed',
        )
        expect(JSON.stringify(logWarn.mock.calls)).not.toContain(
            'synthetic secret',
        )
    })

    it('begrenzt ein hängendes QUIT und behandelt dessen späten Fehler', async function () {
        const quit = Promise.withResolvers<string>()
        const connection = createClient()
        connection.quit.mockReturnValueOnce(quit.promise)
        install('appValkeyConnection', connection)
        const stopping = closeAppConnectionsService()
        await flushPromises()
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs)
        await stopping
        expect(connection.disconnect).toHaveBeenCalledTimes(1)
        expect(logWarn).toHaveBeenCalledWith(
            'runtime.connections.valkey_connection_quit_timeout',
        )
        quit.reject(new Error('late synthetic failure'))
        await flushPromises()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('verwendet nach Queue-Closefehlern den erfolgreichen Disconnect', async function () {
        const queue = createQueue()
        queue.close.mockRejectedValueOnce(new Error('synthetic queue failure'))
        install('appBackupQueue', queue)
        await closeAppConnectionsService()
        expect(queue.disconnect).toHaveBeenCalledTimes(1)
        expect(logWarn).toHaveBeenCalledWith(
            'runtime.connections.backup_queue_close_failed',
        )
    })

    it('versucht trotz begrenztem Queue-Cleanup und fehlgeschlagenem Valkey-Disconnect alle Ressourcen', async function () {
        const close = Promise.withResolvers<void>()
        const disconnect = Promise.withResolvers<void>()
        const mail = createQueue()
        mail.close.mockReturnValueOnce(close.promise)
        mail.disconnect.mockReturnValueOnce(disconnect.promise)
        const backup = createQueue()
        const connection = createClient('reconnecting')
        connection.disconnect.mockImplementationOnce(function () {
            throw new Error('synthetic private error')
        })
        const publisher = createClient()
        install('appMailQueueV2', mail)
        install('appBackupQueue', backup)
        install('appValkeyConnection', connection)
        install('appValkeyPublisher', publisher)
        const outcome = closeAppConnectionsService().catch(
            (error: unknown) => error,
        )
        await flushPromises()
        expect(backup.close).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs)
        await flushPromises()
        expect(mail.disconnect).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(WORKER_SHUTDOWN.cleanupTimeoutMs)
        const error = await outcome
        expect(error).toBeInstanceOf(AggregateError)
        if (!(error instanceof AggregateError))
            throw new Error('AggregateError erwartet')
        expect(error.errors).toHaveLength(2)
        expect(publisher.quit).toHaveBeenCalledTimes(1)
        expect(connection.disconnect).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
        close.resolve()
        disconnect.resolve()
    })
})
