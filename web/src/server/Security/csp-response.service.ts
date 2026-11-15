import { isRedirect } from '@tanstack/react-router'
import { buildContentSecurityPolicyService } from './csp.service.ts'
import type { CspRequestContext } from './Types/csp.types.ts'

function applyCspHeadersService(
    headers: Headers,
    context?: Readonly<CspRequestContext>,
) {
    const contentType = headers
        .get('content-type')
        ?.split(';')[0]
        ?.trim()
        .toLowerCase()
    const isDocument =
        contentType === 'text/html' || contentType === 'application/xhtml+xml'
    headers.set(
        'content-security-policy',
        buildContentSecurityPolicyService(isDocument ? context : undefined),
    )
    if (isDocument) {
        headers.set('cache-control', 'private, no-store, max-age=0')
        headers.set('pragma', 'no-cache')
        headers.delete('etag')
        headers.delete('last-modified')
        headers.delete('expires')
    }
}

export function addCspResponseHeadersService(
    response: Response,
    context?: Readonly<CspRequestContext>,
): Response {
    try {
        applyCspHeadersService(response.headers, context)
        return response
    } catch {
        const headers = new Headers(response.headers)
        applyCspHeadersService(headers, context)
        const securedResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        })

        if (isRedirect(response)) {
            Object.defineProperty(securedResponse, 'options', {
                configurable: true,
                enumerable: true,
                value: response.options,
                writable: true,
            })
        }

        return securedResponse
    }
}
