import { REALTIME_WS_PATH } from '@/lib/Realtime/realtimeProtocol.ts'
import { isLoopbackOriginService } from '@/server/Request/trustedProxy.service.ts'
import {
    getRealtimeHostnameService,
    getRealtimePortService,
} from '@/server/Realtime/environment.service.ts'

export function getRealtimeHealthUrlService(): URL {
    const production = process.env.NODE_ENV === 'production'
    const publishUrl = process.env.REALTIME_PUBLISH_URL?.trim()
    if (production && publishUrl) {
        const url = new URL(publishUrl)
        if (
            url.protocol !== 'http:' ||
            !isLoopbackOriginService(url) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        ) {
            throw new Error(
                'Die WebSocket-Statusprüfung benötigt eine lokale HTTP-Origin.',
            )
        }
        return new URL(REALTIME_WS_PATH, url.origin)
    }
    const port = production
        ? Number(process.env.PORT ?? 3000)
        : getRealtimePortService()
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Ungültiger WebSocket-Port.')
    const hostname =
        !production && ['::', '::1'].includes(getRealtimeHostnameService())
            ? '[::1]'
            : '127.0.0.1'
    return new URL(`http://${hostname}:${port}${REALTIME_WS_PATH}`)
}

export async function probeRealtimeHealthService(
    signal: AbortSignal,
): Promise<boolean> {
    const response = await fetch(getRealtimeHealthUrlService(), {
        method: 'GET',
        signal,
        redirect: 'error',
        cache: 'no-store',
        headers:
            process.env.NODE_ENV === 'production' &&
            process.env.INTERNAL_PROXY_SECRET
                ? {
                      'x-realtime-health-secret':
                          process.env.INTERNAL_PROXY_SECRET,
                  }
                : {},
    })
    // The real upgrade handler returns 426 before authentication for plain HTTP.
    // No session, WebSocket connection or publish operation is created by this probe.
    void response.body?.cancel().catch(() => undefined)
    return response.status === 426
}
