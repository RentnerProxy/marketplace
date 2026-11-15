import { createDedicatedValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import type { BunRealtimeServer } from '@/websockets/Types/bun.ts'
import { logError, logInfo, logWarn } from '@/server/Logging/logger.ts'
import { realtimeEventEnvelopeSchema } from '@/websockets/Types/events.ts'
import { dispatchRealtimeEvent } from './realtimeConnectionRegistry.ts'

export const REALTIME_VALKEY_CHANNEL = 'rentnerproxy-marketplace:realtime'

export async function startRealtimeValkeySubscriber(server: BunRealtimeServer) {
    if (!process.env.VALKEY_URL) {
        return null
    }

    const subscriber = createDedicatedValkeyConnection()
    let pendingSubscription: Promise<void> | null = null
    function subscribe() {
        if (pendingSubscription) return
        pendingSubscription = subscriber
            .subscribe(REALTIME_VALKEY_CHANNEL)
            .then(() => logInfo('realtime.valkey_subscription_ready'))
            .catch(function () {
                logWarn('realtime.valkey_subscription_unavailable')
            })
            .finally(function () {
                pendingSubscription = null
            })
    }
    subscriber.on('ready', subscribe)
    subscriber.on('message', function (_, message) {
        try {
            const payload: unknown = JSON.parse(message)
            const envelope = realtimeEventEnvelopeSchema.safeParse(payload)

            if (!envelope.success) {
                logError(
                    'realtime.valkey_event.invalid',
                    new Error('Realtime Valkey Event ist ungültig.'),
                )
                return
            }

            dispatchRealtimeEvent(
                server,
                envelope.data.topic,
                envelope.data.event,
            )
        } catch (error) {
            logError('realtime.valkey_event.invalid', error)
        }
    })

    subscribe()
    return subscriber
}
