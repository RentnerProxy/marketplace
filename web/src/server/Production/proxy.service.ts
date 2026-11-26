import { PRODUCTION_HTTP_LIMITS } from '@/config/production-server.config.ts'
import { REALTIME_WS_PATH } from '@/lib/Realtime/realtimeProtocol.ts'
import {
    getTrustedForwardedProtocol,
    getValidatedClientIpService,
    isLoopbackIpService,
    isLoopbackOriginService,
    resolveTrustedProxyClientIp,
} from '@/server/Request/trustedProxy.service.ts'
import { addProductionSecurityHeadersService } from './security-headers.service.ts'
import type {
    ProductionProxyConfig,
    ProductionRequestProxyMetadata,
} from './production.types.ts'

const defaultProxyBodyLimitBytes = 16 * 1024 * 1024
const BACKUP_IMPORT_PATH = '/api/admin/backups/import'
const storedBackupPath =
    /^\/api\/admin\/backups\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export const BACKUP_REQUEST_IDLE_TIMEOUT_SECONDS = 255

function isBackupImportRequest(method: string, pathname: string) {
    return method === 'POST' && pathname === BACKUP_IMPORT_PATH
}

export function usesBackupStreamingPolicyService(
    method: string,
    pathname: string,
) {
    return (
        isBackupImportRequest(method, pathname) ||
        ((method === 'GET' || method === 'HEAD') &&
            storedBackupPath.test(pathname))
    )
}

function getProxyBodyLimit(method: string, pathname: string) {
    return isBackupImportRequest(method, pathname)
        ? PRODUCTION_HTTP_LIMITS.maxRequestBodySize
        : defaultProxyBodyLimitBytes
}

function createProxyErrorResponse(
    status: number,
    message: string,
    isHttps: boolean,
) {
    return addProductionSecurityHeadersService(
        new Response(message, {
            status,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
        isHttps,
    )
}

export async function proxyToInternalAppService(
    request: Request,
    proxyMetadata: ProductionRequestProxyMetadata,
    config: ProductionProxyConfig,
) {
    const incomingUrl = new URL(request.url)
    const targetUrl = new URL(request.url)
    targetUrl.protocol = 'http:'
    targetUrl.hostname = '127.0.0.1'
    targetUrl.port = String(config.internalPort)

    const headers = new Headers(request.headers)
    for (const header of [
        'cf-connecting-ip',
        'forwarded',
        'x-app-client-ip',
        'x-app-proxy-secret',
        'x-forwarded-for',
        'x-forwarded-host',
        'x-forwarded-port',
        'x-forwarded-proto',
        'x-real-ip',
    ]) {
        headers.delete(header)
    }
    headers.set('host', config.configuredOrigin.host)
    headers.set('x-app-proxy-secret', config.internalProxySecret)
    headers.set('x-forwarded-host', config.configuredOrigin.host)
    headers.set('x-forwarded-proto', proxyMetadata.publicProtocol)
    headers.set('x-app-client-ip', proxyMetadata.clientIp)

    const bodyLimit = getProxyBodyLimit(request.method, incomingUrl.pathname)
    const declaredContentLength = request.headers.get('content-length')
    const declaredBodySize = declaredContentLength
        ? Number(declaredContentLength)
        : null
    const isHttps = proxyMetadata.publicProtocol === 'https'

    if (
        declaredBodySize !== null &&
        (!Number.isSafeInteger(declaredBodySize) ||
            declaredBodySize < 0 ||
            declaredBodySize > bodyLimit)
    ) {
        return createProxyErrorResponse(
            413,
            'Der Request-Body ist zu groß.',
            isHttps,
        )
    }

    let bodyLimitExceeded = false
    let observedBodySize = 0
    const body =
        request.method === 'GET' || request.method === 'HEAD' || !request.body
            ? undefined
            : request.body.pipeThrough(
                  new TransformStream<Uint8Array, Uint8Array>({
                      transform(chunk, controller) {
                          observedBodySize += chunk.byteLength

                          if (observedBodySize > bodyLimit) {
                              bodyLimitExceeded = true
                              controller.error(
                                  new Error('Request body limit exceeded.'),
                              )
                              return
                          }

                          controller.enqueue(chunk)
                      },
                  }),
              )
    const usesStreamingPolicy = usesBackupStreamingPolicyService(
        request.method,
        incomingUrl.pathname,
    )
    const deadlineSignal = usesStreamingPolicy
        ? null
        : AbortSignal.timeout(2 * 60 * 1_000)
    const proxySignal = deadlineSignal
        ? AbortSignal.any([request.signal, deadlineSignal])
        : request.signal

    let response: Response

    try {
        response = await fetch(targetUrl, {
            method: request.method,
            headers,
            body,
            redirect: 'manual',
            signal: proxySignal,
        })
    } catch (error) {
        if (bodyLimitExceeded) {
            return createProxyErrorResponse(
                413,
                'Der Request-Body ist zu groß.',
                isHttps,
            )
        }

        if (deadlineSignal?.aborted && !request.signal.aborted) {
            return createProxyErrorResponse(
                504,
                'Die maximale Bearbeitungszeit wurde überschritten.',
                isHttps,
            )
        }

        throw error
    }

    return addProductionSecurityHeadersService(
        response,
        isHttps,
        config.websocketOrigin,
    )
}

function hasProxyIdentityHeadersService(request: Request) {
    const directProxyIdentityHeaders = [
        'forwarded',
        'cf-connecting-ip',
        'x-real-ip',
        'x-app-client-ip',
        'x-app-proxy-secret',
    ]
    return [...request.headers.keys()].some(
        (header) =>
            header.startsWith('x-forwarded-') ||
            directProxyIdentityHeaders.some((name) => name === header),
    )
}

export function isLocalProductionHealthcheckService(
    request: Request,
    directIp: string | undefined,
) {
    const url = new URL(request.url)
    return (
        ['http:', 'https:'].includes(url.protocol) &&
        url.pathname === '/healthz' &&
        url.search === '' &&
        (request.method === 'GET' || request.method === 'HEAD') &&
        isLoopbackOriginService(url) &&
        isLoopbackIpService(directIp) &&
        !hasProxyIdentityHeadersService(request)
    )
}

export function isLocalRealtimeHealthProbeService(
    request: Request,
    directIp: string | undefined,
    secret: string,
): boolean {
    const url = new URL(request.url)
    return (
        Boolean(secret) &&
        request.method === 'GET' &&
        url.pathname === REALTIME_WS_PATH &&
        url.search === '' &&
        url.protocol === 'http:' &&
        isLoopbackOriginService(url) &&
        isLoopbackIpService(directIp) &&
        !hasProxyIdentityHeadersService(request) &&
        !request.headers.has('upgrade') &&
        request.headers.get('x-realtime-health-secret') === secret
    )
}

export function getRequestProxyMetadataService(
    request: Request,
    directIp: string | undefined,
    config: ProductionProxyConfig,
): ProductionRequestProxyMetadata | null {
    const publicProtocol =
        config.configuredOrigin.protocol === 'https:' ? 'https' : 'http'
    if (config.trustProxyHeaders) {
        const clientIp = resolveTrustedProxyClientIp(
            {
                directIp,
                forwardedFor: request.headers.get('x-forwarded-for'),
            },
            config.trustedProxyRanges,
        )
        const forwardedProtocol = getTrustedForwardedProtocol(
            request.headers.get('x-forwarded-proto'),
        )
        if (!clientIp || forwardedProtocol !== publicProtocol) return null
        return { clientIp, publicProtocol }
    }
    if (
        isLoopbackOriginService(config.configuredOrigin) &&
        (!isLoopbackIpService(directIp) ||
            hasProxyIdentityHeadersService(request))
    ) {
        return null
    }
    const clientIp = getValidatedClientIpService(directIp)
    return clientIp ? { clientIp, publicProtocol } : null
}
