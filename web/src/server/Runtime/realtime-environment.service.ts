import { hasControlCharacters } from '@/lib/Validation/hasControlCharacters.ts'
import { isIP } from 'node:net'
import { CSP_MAX_WEBSOCKET_URL_LENGTH } from '@/config/security-headers.config.ts'
import { isLoopbackOriginService } from '@/server/Request/trustedProxy.service.ts'
import { isUrlEncodable } from './environment-schema.service.ts'
import type { ResolveRealtimeWebSocketOriginInput } from './Types/realtime-environment.types.ts'

const invalidWebSocketConfiguration =
    'VITE_REALTIME_WS_URL muss eine sichere, eindeutige WebSocket-URL ohne Zugangsdaten, Query, Fragment, Wildcards oder Leerzeichen sein.'

function hasSupportedCspHost(url: URL) {
    if (!/^[a-z0-9.-]+$/i.test(url.hostname)) return false
    return isIP(url.hostname) === 0 || url.hostname === '127.0.0.1'
}

function assertSupportedCspHost(url: URL) {
    if (!hasSupportedCspHost(url)) {
        throw new Error(
            'Die Realtime-CSP benötigt einen DNS-Hostnamen oder 127.0.0.1; andere IP-Literale werden nicht unterstützt.',
        )
    }
}

export function parseConfiguredRealtimeWebSocketUrlService(
    value: unknown,
): string | undefined {
    if (value === undefined || value === '') return undefined
    if (
        typeof value !== 'string' ||
        value.length > CSP_MAX_WEBSOCKET_URL_LENGTH ||
        hasControlCharacters(value) ||
        /[\s*"'<>;,\\?#]/u.test(value) ||
        !isUrlEncodable(value)
    ) {
        throw new Error(invalidWebSocketConfiguration)
    }

    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new Error(invalidWebSocketConfiguration)
    }
    if (
        url.username !== '' ||
        url.password !== '' ||
        url.search !== '' ||
        url.hash !== '' ||
        (url.protocol !== 'wss:' &&
            !(url.protocol === 'ws:' && isLoopbackOriginService(url)))
    ) {
        throw new Error(invalidWebSocketConfiguration)
    }
    assertSupportedCspHost(url)
    return url.href
}

export function resolveRealtimeWebSocketOriginService({
    origin,
    configuredUrl,
    developmentPort,
}: ResolveRealtimeWebSocketOriginInput): string {
    let publicOrigin: URL
    try {
        publicOrigin = new URL(origin)
    } catch {
        throw new Error('ORIGIN ist für die Realtime-CSP ungültig.')
    }
    if (
        origin !== publicOrigin.origin ||
        (publicOrigin.protocol !== 'https:' &&
            !(
                publicOrigin.protocol === 'http:' &&
                isLoopbackOriginService(publicOrigin)
            ))
    ) {
        throw new Error('ORIGIN ist für die Realtime-CSP ungültig.')
    }
    const configured = parseConfiguredRealtimeWebSocketUrlService(configuredUrl)
    if (configured) return new URL(configured).origin

    assertSupportedCspHost(publicOrigin)
    publicOrigin.protocol = publicOrigin.protocol === 'https:' ? 'wss:' : 'ws:'
    if (developmentPort !== undefined) {
        if (
            typeof developmentPort !== 'string' ||
            !/^[1-9][0-9]{0,4}(?![\s\S])/.test(developmentPort)
        ) {
            throw new Error(
                'VITE_REALTIME_WS_DEV_PORT muss ein gültiger Port sein.',
            )
        }
        try {
            publicOrigin = new URL(
                publicOrigin.protocol +
                    '//' +
                    publicOrigin.hostname +
                    ':' +
                    developmentPort,
            )
        } catch {
            throw new Error(
                'VITE_REALTIME_WS_DEV_PORT muss ein gültiger Port sein.',
            )
        }
    }
    return publicOrigin.origin
}
