import { DEFAULT_SECURITY_HEADERS } from '@/config/security-headers.config.ts'
import {
    buildContentSecurityPolicyService,
    validateNonceContentSecurityPolicyService,
} from '@/server/Security/csp.service.ts'

function isHtmlResponse(response: Response) {
    const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase()
    return (
        contentType === 'text/html' || contentType === 'application/xhtml+xml'
    )
}

function rejectUnverifiedHtml(response: Response) {
    try {
        void response.body?.cancel().catch(function () {})
    } catch {}
    return new Response(
        'Die Seite kann derzeit nicht sicher ausgeliefert werden.',
        {
            status: 503,
            headers: {
                'content-type': 'text/plain; charset=utf-8',
                'cache-control': 'private, no-store, max-age=0',
                ...(response.headers.get('referrer-policy') === 'no-referrer'
                    ? { 'referrer-policy': 'no-referrer' }
                    : {}),
            },
        },
    )
}

export function addProductionSecurityHeadersService(
    response: Response,
    isHttps: boolean,
    expectedWebsocketOrigin?: string,
) {
    const html = isHtmlResponse(response)
    const verifiedHtml =
        html &&
        expectedWebsocketOrigin !== undefined &&
        validateNonceContentSecurityPolicyService(
            response.headers.get('content-security-policy'),
            expectedWebsocketOrigin,
        )
    const securedResponse =
        html && !verifiedHtml ? rejectUnverifiedHtml(response) : response
    const headers = new Headers(securedResponse.headers)

    for (const [key, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
        if (key === 'referrer-policy' && headers.get(key) === 'no-referrer') {
            continue
        }
        headers.set(key, value)
    }

    if (!verifiedHtml) {
        headers.set(
            'content-security-policy',
            buildContentSecurityPolicyService(),
        )
    }

    if (isHttps) {
        headers.set(
            'strict-transport-security',
            'max-age=63072000; includeSubDomains; preload',
        )
    }

    if (verifiedHtml) {
        headers.set('cache-control', 'private, no-store, max-age=0')
        headers.set('pragma', 'no-cache')
        headers.delete('etag')
        headers.delete('last-modified')
        headers.delete('expires')
    } else if (!headers.has('cache-control')) {
        headers.set('cache-control', 'private, no-store, max-age=0')
        headers.set('pragma', 'no-cache')
    }

    return new Response(securedResponse.body, {
        headers,
        status: securedResponse.status,
        statusText: securedResponse.statusText,
    })
}
