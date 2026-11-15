import {
    REALTIME_PUBLISH_PATH,
    REALTIME_WS_PATH,
} from '@/lib/Realtime/realtimeProtocol.ts'
import {
    getRealtimeHostnameService,
    getRealtimePortService,
} from '@/server/Realtime/environment.service.ts'
import {
    handleRealtimePublishBridge,
    setRealtimeServer,
} from '@/websockets/Server/realtimeServer.ts'
import {
    handleRealtimeUpgrade,
    realtimeWebSocketHandler,
} from '@/websockets/Server/realtimeWebSocket.ts'
import { startRealtimeValkeySubscriber } from '@/websockets/Server/realtimeValkey.ts'
import { logInfo } from '@/server/Logging/logger.ts'

const DEV_REALTIME_PUBLISH_SECRET = 'xwf'

const hostname = getRealtimeHostnameService()
const port = getRealtimePortService()
const usesValkey = Boolean(process.env.VALKEY_URL)
const hasExplicitPublishSecret = Boolean(
    process.env.REALTIME_PUBLISH_SECRET?.trim(),
)

if (
    !usesValkey &&
    !['127.0.0.1', '::1', 'localhost'].includes(hostname) &&
    !hasExplicitPublishSecret
) {
    throw new Error(
        'REALTIME_PUBLISH_SECRET wird benötigt, wenn der Realtime-Dev-Server außerhalb von Loopback erreichbar ist.',
    )
}

const publishSecret =
    process.env.REALTIME_PUBLISH_SECRET ?? DEV_REALTIME_PUBLISH_SECRET

const server = Bun.serve({
    hostname,
    port,
    async fetch(request, upgradeServer) {
        const url = new URL(request.url)

        if (url.pathname === REALTIME_WS_PATH) {
            return handleRealtimeUpgrade(request, upgradeServer)
        }

        if (url.pathname === REALTIME_PUBLISH_PATH) {
            if (usesValkey) {
                return new Response('Not found', { status: 404 })
            }

            return handleRealtimePublishBridge(request, publishSecret)
        }

        return new Response('Not found', { status: 404 })
    },
    websocket: realtimeWebSocketHandler,
})

setRealtimeServer(server)
logInfo('realtime.server_started', { port })
await startRealtimeValkeySubscriber(server)

const realtimeDevUrl = new URL(
    REALTIME_WS_PATH,
    `http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`,
)
realtimeDevUrl.protocol = 'ws:'

console.log(`➜ Realtime Dev Server: ${realtimeDevUrl}`)
