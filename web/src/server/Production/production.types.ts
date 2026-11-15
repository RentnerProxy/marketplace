import type { TrustedProxyRange } from '@/server/Request/Types/trusted-proxy.types.ts'
import type { AppValkeyClient } from '@/server/Valkey/Types/valkey-client.types.ts'
import type { BunRealtimeServer } from '@/websockets/Types/bun.ts'

export type ProductionShutdownSignal = 'SIGINT' | 'SIGTERM'

export type ProductionShutdownOptions = {
    server: Pick<BunRealtimeServer, 'stop'>
    appProcess: {
        kill: (signal: ProductionShutdownSignal) => void
        exited: Promise<number>
    }
    subscriber: Pick<AppValkeyClient, 'status' | 'quit' | 'disconnect'> | null
    stopSetupLog: () => void
}

export type ProductionAssetConfig = {
    defaultPublicRoot: string
    publicStorageRoot: string
}

export type ProductionProxyConfig = {
    configuredOrigin: URL
    websocketOrigin: string
    internalPort: number
    internalProxySecret: string
    trustedProxyRanges: Array<TrustedProxyRange>
    trustProxyHeaders: boolean
}

export type ProductionRequestProxyMetadata = {
    clientIp: string
    publicProtocol: 'http' | 'https'
}

export type ProductionRequestHandlerConfig = {
    assetConfig: ProductionAssetConfig
    proxyConfig: ProductionProxyConfig
    realtimePublishSecret: string
    isInternalAppReady: () => Promise<boolean>
}
