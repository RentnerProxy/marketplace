import {
    isLegacyUserBackgroundPath,
    serveProductionStorageAssetService,
} from './assets.service.ts'
import {
    BACKUP_REQUEST_IDLE_TIMEOUT_SECONDS,
    getRequestProxyMetadataService,
    isLocalProductionHealthcheckService,
    isLocalRealtimeHealthProbeService,
    proxyToInternalAppService,
    usesBackupStreamingPolicyService,
} from './proxy.service.ts'
import { addProductionSecurityHeadersService } from './security-headers.service.ts'
import type { ProductionRequestHandlerConfig } from './production.types.ts'
import {
    REALTIME_PUBLISH_PATH,
    REALTIME_WS_PATH,
} from '@/lib/Realtime/realtimeProtocol.ts'
import { handleRealtimePublishBridge } from '@/websockets/Server/realtimeServer.ts'
import { handleRealtimeUpgrade } from '@/websockets/Server/realtimeWebSocket.ts'
import type { BunUpgradeServer } from '@/websockets/Types/bun.ts'

export function createProductionRequestHandlerService(
    config: ProductionRequestHandlerConfig,
) {
    return async function handleProductionRequest(
        request: Request,
        upgradeServer: BunUpgradeServer,
    ) {
        const url = new URL(request.url)

        if (url.pathname === REALTIME_PUBLISH_PATH) {
            return handleRealtimePublishBridge(
                request,
                config.realtimePublishSecret,
            )
        }

        const directIp = upgradeServer.requestIP(request)?.address
        if (
            isLocalRealtimeHealthProbeService(
                request,
                directIp,
                config.proxyConfig.internalProxySecret,
            )
        ) {
            return handleRealtimeUpgrade(request, upgradeServer)
        }
        const proxyMetadata = getRequestProxyMetadataService(
            request,
            directIp,
            config.proxyConfig,
        )
        const isHttps =
            config.proxyConfig.configuredOrigin.protocol === 'https:'

        if (
            url.pathname === '/healthz' &&
            (request.method === 'GET' || request.method === 'HEAD') &&
            (proxyMetadata ||
                isLocalProductionHealthcheckService(request, directIp))
        ) {
            const isReady = await config.isInternalAppReady()
            return addProductionSecurityHeadersService(
                new Response(
                    request.method === 'HEAD'
                        ? null
                        : isReady
                          ? 'OK'
                          : 'NOT READY',
                    {
                        status: isReady ? 200 : 503,
                        headers: {
                            'cache-control': 'no-store',
                            'content-type': 'text/plain; charset=utf-8',
                        },
                    },
                ),
                isHttps,
            )
        }
        if (!proxyMetadata) {
            return addProductionSecurityHeadersService(
                new Response(
                    'Die Anfrage kann nicht sicher zugeordnet werden.',
                    {
                        status: 503,
                        headers: {
                            'cache-control': 'no-store',
                            'content-type': 'text/plain; charset=utf-8',
                        },
                    },
                ),
                isHttps,
            )
        }

        if (usesBackupStreamingPolicyService(request.method, url.pathname)) {
            upgradeServer.timeout?.(
                request,
                BACKUP_REQUEST_IDLE_TIMEOUT_SECONDS,
            )
        }
        if (url.pathname === REALTIME_WS_PATH) {
            return handleRealtimeUpgrade(request, upgradeServer)
        }
        if (isLegacyUserBackgroundPath(url.pathname)) {
            return addProductionSecurityHeadersService(
                new Response('Not found', {
                    status: 404,
                    headers: { 'cache-control': 'private, no-store' },
                }),
                isHttps,
            )
        }
        const storageAssetResponse = await serveProductionStorageAssetService(
            request,
            config.assetConfig,
        )
        if (storageAssetResponse) {
            return addProductionSecurityHeadersService(
                storageAssetResponse,
                isHttps,
            )
        }
        return proxyToInternalAppService(
            request,
            proxyMetadata,
            config.proxyConfig,
        )
    }
}
