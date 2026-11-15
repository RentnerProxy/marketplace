import Valkey from 'ioredis'
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'bun:test'
import type { BunRealtimeServer } from '@/websockets/Types/bun.ts'
import { waitForAssertion } from '@/tests/shared/waitForAssertion.ts'

const subscriber = new Valkey('redis://127.0.0.1:9/0', { lazyConnect: true })
const subscribe = vi.spyOn(subscriber, 'subscribe').mockResolvedValue(1)
const createConnection = vi.fn(() => subscriber)
const warn = vi.fn()
const info = vi.fn()
const dispatch = vi.fn()
vi.mock('@/server/Valkey/valkey.service.ts', () => ({
    createDedicatedValkeyConnection: createConnection,
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logError: vi.fn(),
    logInfo: info,
    logWarn: warn,
}))
vi.mock('@/websockets/Server/realtimeConnectionRegistry.ts', () => ({
    dispatchRealtimeEvent: dispatch,
}))

const { REALTIME_VALKEY_CHANNEL, startRealtimeValkeySubscriber } =
    await import('@/websockets/Server/realtimeValkey.ts')
const server = {
    publish: vi.fn(() => 1),
    stop: vi.fn(async () => undefined),
} satisfies BunRealtimeServer
let previousValkeyUrl: string | undefined

beforeEach(function () {
    previousValkeyUrl = process.env.VALKEY_URL
    process.env.VALKEY_URL = 'redis://127.0.0.1:9/0'
    vi.clearAllMocks()
    subscriber.removeAllListeners()
    subscribe.mockReset().mockResolvedValue(1)
    createConnection.mockReset().mockReturnValue(subscriber)
})
afterEach(function () {
    subscriber.removeAllListeners()
    if (previousValkeyUrl === undefined) delete process.env.VALKEY_URL
    else process.env.VALKEY_URL = previousValkeyUrl
})
afterAll(function () {
    subscriber.disconnect()
})

describe('Realtime startup and Valkey recovery', function () {
    it('returns the reconnecting client without waiting for the subscription', async function () {
        const gate = Promise.withResolvers<number>()
        subscribe.mockReturnValueOnce(gate.promise)
        let completed = false
        const pending = startRealtimeValkeySubscriber(server).then(
            function (value) {
                completed = true
                return value
            },
        )
        try {
            await waitForAssertion(function () {
                expect(completed).toBe(true)
            })
            expect(await pending).toBe(subscriber)
        } finally {
            gate.resolve(1)
            await pending
        }
    })

    it('catches connection failures without leaking their private causes', async function () {
        subscribe.mockRejectedValueOnce(new Error('private-valkey-credential'))
        await expect(startRealtimeValkeySubscriber(server)).resolves.toBe(
            subscriber,
        )
        await waitForAssertion(function () {
            expect(warn).toHaveBeenCalledWith(
                'realtime.valkey_subscription_unavailable',
            )
        })
        expect(JSON.stringify(warn.mock.calls)).not.toContain(
            'private-valkey-credential',
        )
    })

    it('subscribes after a failed startup and dispatches validated events after recovery', async function () {
        subscribe.mockRejectedValueOnce(new Error('offline'))
        await startRealtimeValkeySubscriber(server)
        await waitForAssertion(function () {
            expect(warn).toHaveBeenCalledTimes(1)
        })
        subscriber.emit('ready')
        await waitForAssertion(function () {
            expect(info).toHaveBeenCalledWith(
                'realtime.valkey_subscription_ready',
            )
        })
        expect(subscriber.subscribe).toHaveBeenCalledTimes(2)
        expect(subscriber.subscribe).toHaveBeenLastCalledWith(
            REALTIME_VALKEY_CHANNEL,
        )
        const event = {
            type: 'system-settings.updated',
            payload: { companyName: 'Test', updatedAt: '2026-10-01T12:00:00Z' },
        }
        subscriber.emit(
            'message',
            REALTIME_VALKEY_CHANNEL,
            JSON.stringify({ topic: 'system-settings', event }),
        )
        expect(dispatch).toHaveBeenCalledWith(server, 'system-settings', event)
    })

    it('does not start duplicate subscriptions while the current attempt is pending', async function () {
        const gate = Promise.withResolvers<number>()
        subscribe.mockReturnValueOnce(gate.promise)
        await startRealtimeValkeySubscriber(server)
        subscriber.emit('ready')
        subscriber.emit('ready')
        expect(subscriber.subscribe).toHaveBeenCalledTimes(1)
        gate.resolve(1)
        await Bun.sleep(0)
        subscriber.emit('ready')
        await waitForAssertion(function () {
            expect(subscriber.subscribe).toHaveBeenCalledTimes(2)
        })
        expect(subscriber.listenerCount('message')).toBe(1)
    })

    it('keeps the local bridge when Valkey is not configured', async function () {
        delete process.env.VALKEY_URL
        await expect(startRealtimeValkeySubscriber(server)).resolves.toBeNull()
        expect(createConnection).not.toHaveBeenCalled()
    })

    it('continues to reject invalid connection configuration', async function () {
        const error = new Error('invalid Valkey configuration')
        createConnection.mockImplementationOnce(function () {
            throw error
        })
        await expect(startRealtimeValkeySubscriber(server)).rejects.toBe(error)
        expect(subscriber.subscribe).not.toHaveBeenCalled()
    })
})
