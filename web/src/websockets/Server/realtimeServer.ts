import { REALTIME_PUBLISH_PATH } from '@/lib/Realtime/realtimeProtocol.ts'
import {
    getRealtimeHostnameService,
    getRealtimePortService,
} from '@/server/Realtime/environment.service.ts'
import { realtimeEventEnvelopeSchema } from '@/websockets/Types/events.ts'
import type { BunRealtimeServer } from '@/websockets/Types/bun.ts'
import { dispatchRealtimeEvent } from './realtimeConnectionRegistry.ts'
import {
    handleRealtimeUpgrade,
    realtimeWebSocketHandler,
} from './realtimeWebSocket.ts'

declare global {
    var appRealtimeServer: BunRealtimeServer | undefined
}

export function setRealtimeServer(server: BunRealtimeServer) {
    globalThis.appRealtimeServer = server
}

export async function handleRealtimePublishBridge(
    request: Request,
    publishSecret: string,
) {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 })
    }

    if (request.headers.get('x-realtime-publish-secret') !== publishSecret) {
        return new Response('Not found', { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const envelope = realtimeEventEnvelopeSchema.safeParse(body)

    if (!envelope.success) {
        return new Response('Bad request', { status: 400 })
    }

    const realtimeServer = globalThis.appRealtimeServer
    if (!realtimeServer) {
        return new Response('Realtime server unavailable', { status: 503 })
    }

    dispatchRealtimeEvent(
        realtimeServer,
        envelope.data.topic,
        envelope.data.event,
    )

    return Response.json({ success: true })
}

export function ensureRealtimeServer() {
    if (globalThis.appRealtimeServer) {
        return globalThis.appRealtimeServer
    }

    const server = Bun.serve({
        hostname: getRealtimeHostnameService(),
        port: getRealtimePortService(),
        async fetch(request, upgradeServer) {
            const url = new URL(request.url)

            if (url.pathname === REALTIME_PUBLISH_PATH) {
                const publishSecret = process.env.REALTIME_PUBLISH_SECRET

                if (!publishSecret) {
                    return new Response('Not found', { status: 404 })
                }

                return handleRealtimePublishBridge(request, publishSecret)
            }

            return handleRealtimeUpgrade(request, upgradeServer)
        },
        websocket: realtimeWebSocketHandler,
    })

    setRealtimeServer(server)

    return server
}
