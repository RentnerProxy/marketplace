import type { SocketHandler } from './realtimeEventsClient.test.types.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { parseRealtimeEvent } from '@/lib/Realtime/realtimeEventGuard.ts'

const parseMock = (function () {
    return vi.fn()
})()

vi.mock('@/lib/Realtime/realtimeEventGuard.ts', function () {
    return { parseRealtimeEvent: parseMock }
})

class FakeWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    static instances: Array<FakeWebSocket> = []
    static throwOnNextConstruction = false

    readonly url: string
    readyState = FakeWebSocket.CONNECTING
    readonly send = vi.fn()
    readonly close = vi.fn(() => {
        if (this.readyState === FakeWebSocket.CLOSED) {
            return
        }
        this.readyState = FakeWebSocket.CLOSED
        this.emit('close')
    })
    private readonly handlers = new Map<string, Array<SocketHandler>>()

    constructor(url: string) {
        if (FakeWebSocket.throwOnNextConstruction) {
            FakeWebSocket.throwOnNextConstruction = false
            throw new Error('WebSocket nicht verfügbar')
        }
        this.url = url
        FakeWebSocket.instances.push(this)
    }

    addEventListener(type: string, handler: SocketHandler) {
        const handlers = this.handlers.get(type) ?? []
        handlers.push(handler)
        this.handlers.set(type, handlers)
    }

    emit(type: string, event: { data?: unknown } = {}) {
        for (const handler of this.handlers.get(type) ?? []) {
            handler(event)
        }
    }

    open() {
        this.readyState = FakeWebSocket.OPEN
        this.emit('open')
    }
}

function createWindowMock(origin = 'https://app.example.test') {
    const handlers = new Map<string, Array<() => void>>()
    return {
        handlers,
        location: { origin },
        addEventListener: vi.fn(function (type: string, handler: () => void) {
            const currentHandlers = handlers.get(type) ?? []
            currentHandlers.push(handler)
            handlers.set(type, currentHandlers)
        }),
        emit: function (type: string) {
            for (const handler of handlers.get(type) ?? []) {
                handler()
            }
        },
    }
}

const windowMock = createWindowMock()
const originalDevEnvironment = process.env.DEV
const originalRealtimeDevPort = process.env.VITE_REALTIME_WS_DEV_PORT

function restoreRealtimeTestEnvironment() {
    if (originalDevEnvironment === undefined) {
        delete process.env.DEV
    } else {
        process.env.DEV = originalDevEnvironment
    }

    if (originalRealtimeDevPort === undefined) {
        delete process.env.VITE_REALTIME_WS_DEV_PORT
    } else {
        process.env.VITE_REALTIME_WS_DEV_PORT = originalRealtimeDevPort
    }
}

async function loadClient() {
    return import('@/websockets/Client/realtimeEventsClient.ts')
}

async function flushPromises() {
    await Promise.resolve()
    await Promise.resolve()
}

async function advanceTimersByTime(milliseconds: number) {
    vi.advanceTimersByTime(milliseconds)
    await flushPromises()
}

describe('Realtime-Events-Client', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.spyOn(Math, 'random').mockReturnValue(0)
        FakeWebSocket.instances = []
        FakeWebSocket.throwOnNextConstruction = false
        process.env.DEV = 'true'
        process.env.VITE_REALTIME_WS_DEV_PORT = '3001'
        windowMock.location.origin = 'https://app.example.test'
        stubTestGlobal('WebSocket', FakeWebSocket)
        stubTestGlobal('window', windowMock)
        windowMock.emit('pageshow')
        parseMock.mockImplementation(function (data: string) {
            return data === 'valid'
                ? {
                      type: 'system-settings.updated',
                      payload: { companyName: 'Example' },
                  }
                : null
        })
    })

    afterEach(function () {
        windowMock.emit('pageshow')
        vi.useRealTimers()
        vi.restoreAllMocks()
        restoreTestGlobals()
        restoreRealtimeTestEnvironment()
    })

    it('verbindet, sendet Heartbeats und dispatcht nur gültige Events', async function () {
        const listener = vi.fn()
        const { subscribeToRealtimeEvents } = await loadClient()

        const unsubscribe = subscribeToRealtimeEvents(listener)
        await flushPromises()

        expect(FakeWebSocket.instances).toHaveLength(1)
        const socket = FakeWebSocket.instances[0]
        expect(socket?.url).toMatch(
            /^wss:\/\/app\.example\.test(?::3001)?\/ws$/,
        )
        expect(windowMock.handlers.get('pagehide')).toHaveLength(1)
        expect(windowMock.handlers.get('pageshow')).toHaveLength(1)

        socket?.open()
        await advanceTimersByTime(45_000)
        expect(socket?.send).toHaveBeenCalledWith('ping')

        socket?.emit('message', { data: new Uint8Array([1]) })
        socket?.emit('message', { data: 'pong' })
        socket?.emit('message', { data: 'invalid' })
        socket?.emit('message', { data: 'valid' })

        expect(parseRealtimeEvent).toHaveBeenCalledTimes(2)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'system-settings.updated' }),
        )

        unsubscribe()
        expect(socket?.close).toHaveBeenCalledTimes(1)
    })

    it('isoliert Fehler asynchroner Listener', async function () {
        const error = new Error('Listener kaputt')
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(function () {})
        const { subscribeToRealtimeEvents } = await loadClient()
        const unsubscribe = subscribeToRealtimeEvents(async function () {
            throw error
        })
        await flushPromises()

        FakeWebSocket.instances[0]?.emit('message', { data: 'valid' })
        await flushPromises()

        expect(consoleSpy).toHaveBeenCalledWith(
            'Realtime event listener failed',
            error,
        )
        unsubscribe()
    })

    it('hält die Verbindung bis zum letzten Unsubscribe offen', async function () {
        const { subscribeToRealtimeEvents } = await loadClient()
        const unsubscribeFirst = subscribeToRealtimeEvents(vi.fn())
        const unsubscribeSecond = subscribeToRealtimeEvents(vi.fn())
        await flushPromises()
        const socket = FakeWebSocket.instances[0]

        expect(FakeWebSocket.instances).toHaveLength(1)
        unsubscribeFirst()
        expect(socket?.close).not.toHaveBeenCalled()
        unsubscribeSecond()
        expect(socket?.close).toHaveBeenCalledTimes(1)
    })

    it('isoliert synchrone Listenerfehler und benachrichtigt weitere Listener', async function () {
        const error = new Error('Synchroner Listenerfehler')
        const report = vi.spyOn(console, 'error').mockImplementation(() => {})
        const { subscribeToRealtimeEvents } = await loadClient()
        const unsubscribeBroken = subscribeToRealtimeEvents(() => {
            throw error
        })
        const nextListener = vi.fn()
        const unsubscribeNext = subscribeToRealtimeEvents(nextListener)

        expect(() =>
            FakeWebSocket.instances[0]?.emit('message', { data: 'valid' }),
        ).not.toThrow()
        expect(nextListener).toHaveBeenCalledTimes(1)
        expect(report).toHaveBeenCalledWith(
            'Realtime event listener failed',
            error,
        )
        unsubscribeBroken()
        unsubscribeNext()
    })

    it('schließt bei Fehlern und verbindet mit Backoff erneut', async function () {
        const { subscribeToRealtimeEvents } = await loadClient()
        const unsubscribe = subscribeToRealtimeEvents(vi.fn())
        await flushPromises()
        const firstSocket = FakeWebSocket.instances[0]

        firstSocket?.emit('error')
        expect(firstSocket?.close).toHaveBeenCalledTimes(1)
        expect(FakeWebSocket.instances).toHaveLength(1)

        await advanceTimersByTime(999)
        expect(FakeWebSocket.instances).toHaveLength(1)
        await advanceTimersByTime(1)
        expect(FakeWebSocket.instances).toHaveLength(2)

        unsubscribe()
    })

    it('pausiert bei pagehide und verbindet erst nach pageshow neu', async function () {
        windowMock.location.origin = 'http://localhost:3000'
        const { subscribeToRealtimeEvents } = await loadClient()
        const unsubscribe = subscribeToRealtimeEvents(vi.fn())
        await flushPromises()
        const firstSocket = FakeWebSocket.instances[0]

        windowMock.emit('pagehide')
        expect(firstSocket?.close).toHaveBeenCalledTimes(1)
        await advanceTimersByTime(30_000)
        expect(FakeWebSocket.instances).toHaveLength(1)

        windowMock.emit('pageshow')
        await flushPromises()
        expect(FakeWebSocket.instances).toHaveLength(2)
        expect(FakeWebSocket.instances[1]?.url).toMatch(
            /^ws:\/\/localhost(?::3001)?\/ws$/,
        )

        unsubscribe()
    })

    it('reconnectet eine bestehende oder bereits geschlossene Verbindung', async function () {
        const { reconnectRealtimeEvents, subscribeToRealtimeEvents } =
            await loadClient()
        const unsubscribe = subscribeToRealtimeEvents(vi.fn())
        await flushPromises()
        const firstSocket = FakeWebSocket.instances[0]

        reconnectRealtimeEvents()
        expect(firstSocket?.close).toHaveBeenCalledTimes(1)

        reconnectRealtimeEvents()
        await flushPromises()
        expect(FakeWebSocket.instances).toHaveLength(2)

        unsubscribe()
    })

    it('erholt sich von einem synchronen Konstruktorfehler', async function () {
        FakeWebSocket.throwOnNextConstruction = true
        const { subscribeToRealtimeEvents } = await loadClient()
        const unsubscribe = subscribeToRealtimeEvents(vi.fn())
        await flushPromises()

        expect(FakeWebSocket.instances).toHaveLength(0)
        await advanceTimersByTime(1_000)
        expect(FakeWebSocket.instances).toHaveLength(1)

        unsubscribe()
    })

    it('bleibt während einer suspendierten Seite auch bei manuellem Reconnect offline', async function () {
        const { reconnectRealtimeEvents, subscribeToRealtimeEvents } =
            await loadClient()
        const unsubscribe = subscribeToRealtimeEvents(vi.fn())
        await flushPromises()

        windowMock.emit('pagehide')
        reconnectRealtimeEvents()
        await flushPromises()

        expect(FakeWebSocket.instances).toHaveLength(1)
        unsubscribe()
    })
})
