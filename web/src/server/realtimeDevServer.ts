import {
    REALTIME_PUBLISH_PATH,
    REALTIME_WS_PATH,
} from '@/lib/Realtime/realtimeProtocol.ts'
import {
    DEV_REALTIME_PUBLISH_SECRET,
    getRealtimeHostnameService,
    getRealtimePortService,
} from '@/server/Realtime/environment.service.ts'
import { logError, logInfo } from '@/server/Logging/logger.ts'
import { parseDevelopmentSetupEnvironmentService } from '@/server/Runtime/development-setup-environment.service.ts'
import { closeAppConnectionsService } from '@/server/Runtime/app-connections.service.ts'

const environment = parseDevelopmentSetupEnvironmentService(process.env)
process.env.DATABASE_URL = environment.DATABASE_URL
process.env.VALKEY_URL = environment.VALKEY_URL
const setupAbort = new AbortController()

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
    process.env.REALTIME_PUBLISH_SECRET?.trim() || DEV_REALTIME_PUBLISH_SECRET

const [
    { handleRealtimePublishBridge, setRealtimeServer },
    { handleRealtimeUpgrade, realtimeWebSocketHandler },
    { startRealtimeValkeySubscriber },
] = await Promise.all([
    import('@/websockets/Server/realtimeServer.ts'),
    import('@/websockets/Server/realtimeWebSocket.ts'),
    import('@/websockets/Server/realtimeValkey.ts'),
])

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
const subscriber = await startRealtimeValkeySubscriber(server)
let shutdownStarted = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, function () {
        if (shutdownStarted) return
        shutdownStarted = true
        setupAbort.abort()
        void shutdown().then(
            () => process.exit(0),
            function (error) {
                logError('development.shutdown_failed', error)
                process.exit(1)
            },
        )
    })
}

async function shutdown() {
    const { db } = await import('@/db/index.ts')
    const results = await Promise.allSettled([
        Promise.resolve().then(() => server.stop(true)),
        Promise.resolve().then(() => closeAppConnectionsService()),
        Promise.resolve().then(() => db.$client.close({ timeout: 1 })),
        Promise.resolve().then(() => subscriber?.disconnect()),
    ])
    if (results.some((result) => result.status === 'rejected')) {
        throw new Error(
            'Development-Verbindungen konnten nicht vollständig beendet werden.',
        )
    }
}

const { startFirstSuperUserSetupLogService } =
    await import('@/server/SystemBootstrap/first-super-user-setup-log.service.ts')
await startFirstSuperUserSetupLogService(environment.ORIGIN, setupAbort.signal)

const realtimeDevUrl = new URL(
    REALTIME_WS_PATH,
    `http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`,
)
realtimeDevUrl.protocol = 'ws:'

console.log(`➜ Realtime Dev Server: ${realtimeDevUrl}`)
