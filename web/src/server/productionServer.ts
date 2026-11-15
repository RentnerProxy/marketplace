import path from 'node:path'
import { MAX_PRODUCTION_REQUEST_BODY_BYTES } from '@/server/Production/proxy.service.ts'
import { createProductionRequestHandlerService } from '@/server/Production/request-handler.service.ts'
import type {
    ProductionAssetConfig,
    ProductionProxyConfig,
} from '@/server/Production/production.types.ts'
import { parseTrustedProxyRanges } from '@/server/Request/trustedProxy.service.ts'
import { resolveRealtimeWebSocketOriginService } from '@/server/Runtime/realtime-environment.service.ts'
import { REALTIME_PUBLISH_PATH } from '@/lib/Realtime/realtimeProtocol.ts'
import { startRealtimeValkeySubscriber } from '@/websockets/Server/realtimeValkey.ts'
import { setRealtimeServer } from '@/websockets/Server/realtimeServer.ts'
import { realtimeWebSocketHandler } from '@/websockets/Server/realtimeWebSocket.ts'
import { createAppReadinessCheckService } from '@/server/Runtime/app-readiness.service.ts'
import { startFirstSuperUserSetupLogService } from '@/server/SystemBootstrap/first-super-user-setup-log.service.ts'
import { logError, logInfo } from '@/server/Logging/logger.ts'
import { shutdownProductionServerService } from '@/server/Production/shutdown.service.ts'

const publicPort = Number(Bun.env.PORT ?? 3000)
const internalPort = Number(Bun.env.INTERNAL_APP_PORT ?? 3002)
const hostname = Bun.env.HOST ?? '0.0.0.0'
const configuredOrigin = new URL(
    process.env.ORIGIN?.trim() ?? `http://localhost:${publicPort}`,
)
const childEnv: Record<string, string | undefined> = {}
const realtimePublishSecret = crypto.randomUUID()
const internalProxySecret = crypto.randomUUID()
const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === 'true'
const trustedProxyRanges = trustProxyHeaders
    ? parseTrustedProxyRanges(process.env.TRUSTED_PROXY_RANGES ?? '')
    : []
const assetConfig: ProductionAssetConfig = {
    publicStorageRoot: path.resolve(
        Bun.env.APP_STORAGE_DIR ?? path.join(process.cwd(), 'web', 'public'),
    ),
    defaultPublicRoot: path.resolve(
        Bun.env.APP_DEFAULT_PUBLIC_DIR ??
            path.join(process.cwd(), 'web', 'public'),
    ),
}
const proxyConfig: ProductionProxyConfig = {
    configuredOrigin,
    websocketOrigin: resolveRealtimeWebSocketOriginService({
        origin: configuredOrigin.origin,
        configuredUrl: process.env.VITE_REALTIME_WS_URL,
    }),
    internalPort,
    internalProxySecret,
    trustedProxyRanges,
    trustProxyHeaders,
}
let realtimeValkeySubscriber: Awaited<
    ReturnType<typeof startRealtimeValkeySubscriber>
> = null
const isInternalAppReady = createAppReadinessCheckService(internalPort)

for (const [key, value] of Object.entries(Bun.env)) {
    childEnv[key] = typeof value === 'string' ? value : String(value)
}

if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) {
    throw new Error('PORT muss ein gültiger Port sein.')
}

if (
    !Number.isInteger(internalPort) ||
    internalPort < 1 ||
    internalPort > 65535
) {
    throw new Error('INTERNAL_APP_PORT muss ein gültiger Port sein.')
}

const server = Bun.serve({
    hostname,
    port: publicPort,
    idleTimeout: 60,
    maxRequestBodySize: MAX_PRODUCTION_REQUEST_BODY_BYTES,
    fetch: createProductionRequestHandlerService({
        proxyConfig,
        assetConfig,
        realtimePublishSecret,
        isInternalAppReady,
    }),
    websocket: realtimeWebSocketHandler,
})

setRealtimeServer(server)
logInfo('realtime.server_started', { port: publicPort })
realtimeValkeySubscriber = await startRealtimeValkeySubscriber(server)
const setupLinkLog = await startFirstSuperUserSetupLogService(
    configuredOrigin.origin,
)

console.log(`➜ Listening on: http://${hostname}:${publicPort}/`)

const appProcess = Bun.spawn(
    [process.execPath, '--no-env-file', '.output/server/index.mjs'],
    {
        env: {
            ...childEnv,
            HOST: '127.0.0.1',
            PORT: String(internalPort),
            REALTIME_PUBLISH_URL: `http://127.0.0.1:${publicPort}${REALTIME_PUBLISH_PATH}`,
            REALTIME_PUBLISH_SECRET: realtimePublishSecret,
            INTERNAL_PROXY_SECRET: internalProxySecret,
        },
        stdout: 'inherit',
        stderr: 'inherit',
    },
)

let isShuttingDown = false

void appProcess.exited.then((exitCode) => {
    if (isShuttingDown) {
        return undefined
    }

    console.error(`Interner App-Server wurde mit Code ${exitCode} beendet.`)
    setupLinkLog.stop()
    return process.exit(exitCode || 1)
})

async function shutdown(signal: 'SIGINT' | 'SIGTERM') {
    if (isShuttingDown) {
        return
    }

    isShuttingDown = true
    const exitCode = await shutdownProductionServerService(
        {
            server,
            appProcess,
            subscriber: realtimeValkeySubscriber,
            stopSetupLog: () => setupLinkLog.stop(),
        },
        signal,
    )
    logInfo('realtime.server_stopped', { port: publicPort })
    process.exit(exitCode)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, function () {
        void shutdown(signal).catch(function (error) {
            logError('production.shutdown_failed', error)
            process.exit(1)
        })
    })
}
