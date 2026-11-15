import { describe, expect, it, vi } from 'bun:test'
import {
    buildContentSecurityPolicyService,
    withRequestCspContextService,
} from '@/server/Security/csp.service.ts'
import { addProductionSecurityHeadersService } from '@/server/Production/security-headers.service.ts'

const socketOrigin = 'wss://app.example.test'
function validPolicy(websocketOrigin = socketOrigin) {
    return withRequestCspContextService(websocketOrigin, function (context) {
        return buildContentSecurityPolicyService(context)
    })
}

describe('production nonce CSP boundary', function () {
    it.each([
        'text/html',
        'text/html; charset=utf-8',
        'TEXT/HTML; charset=UTF-8',
        'application/xhtml+xml',
    ])(
        'preserves a verified nonce policy and the original HTML response stream',
        async function (contentType) {
            const policy = validPolicy()
            const body = new ReadableStream<Uint8Array>(
                {
                    pull(controller) {
                        controller.enqueue(
                            new TextEncoder().encode('<html>synthetic</html>'),
                        )
                        controller.close()
                    },
                },
                { highWaterMark: 0 },
            )
            const upstream = new Response(body, {
                status: 201,
                headers: {
                    'content-type': contentType,
                    'content-security-policy': policy,
                    'referrer-policy': 'no-referrer',
                    'set-cookie':
                        'synthetic=public-test-value; Secure; HttpOnly',
                },
            })
            const response = addProductionSecurityHeadersService(
                upstream,
                true,
                socketOrigin,
            )
            expect(response.status).toBe(201)
            expect(response.body).toBe(upstream.body)
            expect(upstream.bodyUsed).toBe(false)
            expect(response.headers.get('content-security-policy')).toBe(policy)
            expect(response.headers.get('referrer-policy')).toBe('no-referrer')
            expect(response.headers.get('set-cookie')).toBe(
                'synthetic=public-test-value; Secure; HttpOnly',
            )
            expect(response.headers.get('strict-transport-security')).toContain(
                'max-age=',
            )
            expect(await response.text()).toBe('<html>synthetic</html>')
        },
    )

    it('prevents shared-cache and conditional reuse of a nonce document', function () {
        const response = addProductionSecurityHeadersService(
            new Response(null, {
                headers: {
                    'content-type': 'text/html',
                    'content-security-policy': validPolicy(),
                    'cache-control': 'public, max-age=3600',
                    etag: '"synthetic-tag"',
                    'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT',
                    expires: 'Mon, 01 Jan 2035 00:00:00 GMT',
                },
            }),
            true,
            socketOrigin,
        )
        expect(response.headers.get('cache-control')).toBe(
            'private, no-store, max-age=0',
        )
        expect(response.headers.get('pragma')).toBe('no-cache')
        expect(response.headers.has('etag')).toBe(false)
        expect(response.headers.has('last-modified')).toBe(false)
        expect(response.headers.has('expires')).toBe(false)
    })

    it.each([
        undefined,
        '',
        "default-src *; script-src 'unsafe-inline'",
        buildContentSecurityPolicyService(),
    ])(
        'fails closed for HTML without the exact nonce-bearing policy',
        async function (policy) {
            const cancel = vi.fn()
            const body = new ReadableStream<Uint8Array>(
                { cancel },
                { highWaterMark: 0 },
            )
            const response = addProductionSecurityHeadersService(
                new Response(body, {
                    headers: {
                        'content-type': 'text/html',
                        ...(policy === undefined
                            ? {}
                            : { 'content-security-policy': policy }),
                        'referrer-policy': 'no-referrer',
                        'cache-control': 'public, max-age=3600',
                        'set-cookie': 'synthetic=discarded',
                        location: '/discarded',
                        'content-length': '999999',
                        'content-encoding': 'gzip',
                    },
                }),
                true,
                socketOrigin,
            )
            expect(response.status).toBe(503)
            expect(cancel).toHaveBeenCalledTimes(1)
            expect(response.headers.get('content-type')).toBe(
                'text/plain; charset=utf-8',
            )
            expect(response.headers.get('content-security-policy')).toBe(
                buildContentSecurityPolicyService(),
            )
            expect(response.headers.get('content-security-policy')).toContain(
                "script-src 'none'",
            )
            expect(
                response.headers.get('content-security-policy'),
            ).not.toContain('nonce-')
            expect(response.headers.get('referrer-policy')).toBe('no-referrer')
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store, max-age=0',
            )
            for (const header of [
                'set-cookie',
                'location',
                'content-length',
                'content-encoding',
            ]) {
                expect(response.headers.has(header)).toBe(false)
            }
            expect(await response.text()).not.toContain('<html>')
        },
    )

    it('rejects an otherwise valid policy for a different configured WebSocket origin', async function () {
        const response = addProductionSecurityHeadersService(
            new Response('discarded html', {
                headers: {
                    'content-type': 'text/html',
                    'content-security-policy': validPolicy(
                        'wss://other.example.test',
                    ),
                },
            }),
            true,
            socketOrigin,
        )
        expect(response.status).toBe(503)
        expect(await response.text()).not.toContain('discarded html')
    })

    it('does not trust HTML policy when the outer caller omitted its expected origin', function () {
        const response = addProductionSecurityHeadersService(
            new Response(null, {
                headers: {
                    'content-type': 'text/html',
                    'content-security-policy': validPolicy(),
                },
            }),
            true,
        )
        expect(response.status).toBe(503)
    })

    it.each([
        "; script-src 'unsafe-inline'",
        '; connect-src wss:',
        '; report-uri https://other.example.test/',
        ', default-src *',
    ])(
        'rejects extra directives and additional policies without forwarding the body',
        function (suffix) {
            const response = addProductionSecurityHeadersService(
                new Response(null, {
                    headers: {
                        'content-type': 'text/html',
                        'content-security-policy': validPolicy() + suffix,
                    },
                }),
                true,
                socketOrigin,
            )
            expect(response.status).toBe(503)
        },
    )

    it.each([
        'text/plain',
        'application/json',
        'text/javascript',
        'image/webp',
        'application/octet-stream',
    ])(
        'uses the strict nonce-free fallback for non-HTML without changing cache, status or bytes',
        async function (contentType) {
            const response = addProductionSecurityHeadersService(
                new Response('synthetic bytes', {
                    status: 202,
                    headers: {
                        'content-type': contentType,
                        'content-security-policy': validPolicy(),
                        'cache-control': 'public, max-age=31536000, immutable',
                    },
                }),
                false,
                socketOrigin,
            )
            expect(response.status).toBe(202)
            expect(response.headers.get('content-security-policy')).toBe(
                buildContentSecurityPolicyService(),
            )
            expect(
                response.headers.get('content-security-policy'),
            ).not.toContain('nonce-')
            expect(response.headers.get('cache-control')).toBe(
                'public, max-age=31536000, immutable',
            )
            expect(response.headers.has('strict-transport-security')).toBe(
                false,
            )
            expect(await response.text()).toBe('synthetic bytes')
        },
    )

    it('keeps the legacy reset redirect and its stronger referrer policy', function () {
        const response = addProductionSecurityHeadersService(
            new Response(null, {
                status: 303,
                headers: {
                    location: '/password-reset#token=synthetic',
                    'referrer-policy': 'no-referrer',
                    'cache-control': 'private, no-store, max-age=0',
                },
            }),
            true,
            socketOrigin,
        )
        expect(response.status).toBe(303)
        expect(response.body).toBeNull()
        expect(response.headers.get('location')).toBe(
            '/password-reset#token=synthetic',
        )
        expect(response.headers.get('referrer-policy')).toBe('no-referrer')
        expect(response.headers.get('content-security-policy')).toContain(
            "script-src 'none'",
        )
    })

    it('preserves upstream cancellation of a valid streaming response', async function () {
        const cancel = vi.fn()
        const body = new ReadableStream<Uint8Array>(
            { cancel },
            { highWaterMark: 0 },
        )
        const response = addProductionSecurityHeadersService(
            new Response(body, {
                headers: {
                    'content-type': 'text/html',
                    'content-security-policy': validPolicy(),
                },
            }),
            true,
            socketOrigin,
        )
        await response.body?.cancel()
        expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('observes rejection of discarded body cancellation and still returns the fixed 503', async function () {
        const cancel = vi.fn(async function () {
            throw new Error('synthetic upstream cancellation failure')
        })
        const response = addProductionSecurityHeadersService(
            new Response(
                new ReadableStream<Uint8Array>(
                    { cancel },
                    { highWaterMark: 0 },
                ),
                { headers: { 'content-type': 'text/html' } },
            ),
            true,
            socketOrigin,
        )
        expect(response.status).toBe(503)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(await response.text()).not.toContain('upstream')
    })
})
