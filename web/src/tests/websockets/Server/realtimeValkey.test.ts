import type { MessageListener } from './realtimeValkey.test.types.ts'
import { afterEach, describe, expect, it, vi } from 'bun:test'
import { logError } from '@/server/Logging/logger.ts'
import type { BunRealtimeServer } from '@/websockets/Types/bun.ts'
import { dispatchRealtimeEvent } from '@/websockets/Server/realtimeConnectionRegistry.ts'
import {
    REALTIME_VALKEY_CHANNEL,
    startRealtimeValkeySubscriber,
} from '@/websockets/Server/realtimeValkey.ts'

const realtimeValkeyMocks = (function () {
    let messageListener: MessageListener | undefined
    const subscriber = {
        on: vi.fn(function (event: string, listener: MessageListener) {
            if (event === 'message') {
                messageListener = listener
            }
        }),
        subscribe: vi.fn(async function () {}),
    }

    return {
        getMessageListener: function () {
            return messageListener
        },
        subscriber,
    }
})()

vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        createDedicatedValkeyConnection: vi.fn(function () {
            return realtimeValkeyMocks.subscriber
        }),
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return {
        logError: vi.fn(function () {}),
        logInfo: vi.fn(function () {}),
        logWarn: vi.fn(function () {}),
    }
})

vi.mock('@/websockets/Server/realtimeConnectionRegistry.ts', function () {
    return {
        dispatchRealtimeEvent: vi.fn(function () {}),
    }
})

const previousValkeyUrl = process.env.VALKEY_URL

describe('Realtime-Valkey-Subscriber', function () {
    afterEach(function () {
        vi.clearAllMocks()

        if (previousValkeyUrl === undefined) {
            delete process.env.VALKEY_URL
        } else {
            process.env.VALKEY_URL = previousValkeyUrl
        }
    })

    it('protokolliert ungültige Envelopes ohne sie zu verteilen', async function () {
        process.env.VALKEY_URL = 'redis://127.0.0.1:6379/15'
        const server = {
            publish: vi.fn(function () {
                return 1
            }),
            stop: vi.fn(async function () {}),
        } satisfies BunRealtimeServer

        await startRealtimeValkeySubscriber(server)
        expect(realtimeValkeyMocks.subscriber.subscribe).toHaveBeenCalledWith(
            REALTIME_VALKEY_CHANNEL,
        )

        const messageListener = realtimeValkeyMocks.getMessageListener()
        expect(messageListener).toBeDefined()
        messageListener?.(REALTIME_VALKEY_CHANNEL, JSON.stringify({}))

        expect(logError).toHaveBeenCalledWith(
            'realtime.valkey_event.invalid',
            expect.any(Error),
        )
        expect(dispatchRealtimeEvent).not.toHaveBeenCalled()
    })
})
