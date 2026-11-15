import { describe, expect, it, vi } from 'bun:test'
import { isRedirect, redirect } from '@tanstack/react-router'
import { addCspResponseHeadersService } from '@/server/Security/csp-response.service.ts'
import { buildContentSecurityPolicyService } from '@/server/Security/csp.service.ts'
import type { CspRequestContext } from '@/server/Security/Types/csp.types.ts'

const context = {
    nonce: Buffer.alloc(32, 7).toString('base64url'),
    websocketOrigin: 'wss://realtime.example.test',
} satisfies CspRequestContext

describe('CSP response finalization', () => {
    it.each([
        'text/html',
        'text/html; charset=utf-8',
        'TEXT/HTML ; charset=utf-8',
        'application/xhtml+xml',
    ])(
        'binds %s to the current nonce and removes reusable body validators',
        (contentType) => {
            const original = new Response('Synthetic document', {
                status: 202,
                headers: {
                    'content-type': contentType,
                    'content-security-policy': "script-src * 'unsafe-inline'",
                    'cache-control': 'public, max-age=3600',
                    etag: '"synthetic-old-body"',
                    'last-modified': 'Sat, 05 Sep 2026 10:00:00 GMT',
                    'referrer-policy': 'no-referrer',
                },
            })
            const body = original.body
            const result = addCspResponseHeadersService(original, context)
            expect(result).toBe(original)
            expect(result.body).toBe(body)
            expect(result.status).toBe(202)
            expect(result.headers.get('content-security-policy')).toBe(
                buildContentSecurityPolicyService(context),
            )
            expect(result.headers.get('cache-control')).toBe(
                'private, no-store, max-age=0',
            )
            expect(result.headers.get('pragma')).toBe('no-cache')
            expect(result.headers.has('etag')).toBe(false)
            expect(result.headers.has('last-modified')).toBe(false)
            expect(result.headers.get('referrer-policy')).toBe('no-referrer')
        },
    )

    it.each([
        'application/javascript',
        'application/json',
        'image/webp',
        'text/plain',
        'text/html-other',
    ])(
        'uses a strict nonce-free fallback for %s and preserves its cache policy',
        (contentType) => {
            const original = new Response('Synthetic asset', {
                headers: {
                    'content-type': contentType,
                    'cache-control': 'public, max-age=31536000, immutable',
                    etag: '"asset-version"',
                },
            })
            const result = addCspResponseHeadersService(original, context)
            expect(result).toBe(original)
            expect(result.headers.get('content-security-policy')).toBe(
                buildContentSecurityPolicyService(),
            )
            expect(result.headers.get('cache-control')).toBe(
                'public, max-age=31536000, immutable',
            )
            expect(result.headers.get('etag')).toBe('"asset-version"')
            expect(result.headers.has('pragma')).toBe(false)
        },
    )

    it('fails closed for a document without a request context', () => {
        const result = addCspResponseHeadersService(
            new Response('Synthetic error', {
                headers: { 'content-type': 'text/html' },
            }),
        )
        expect(result.headers.get('content-security-policy')).toBe(
            buildContentSecurityPolicyService(),
        )
        expect(result.headers.get('cache-control')).toBe(
            'private, no-store, max-age=0',
        )
    })

    it('preserves cookies and unresolved TanStack redirect options', () => {
        const original = redirect({
            to: '/login',
            hash: 'synthetic',
            statusCode: 307,
        })
        original.headers.append('set-cookie', 'first=one; HttpOnly')
        original.headers.append('set-cookie', 'second=two; HttpOnly')
        const result = addCspResponseHeadersService(original, context)
        expect(result).toBe(original)
        expect(isRedirect(result)).toBe(true)
        expect(Reflect.get(result, 'options')).toBe(original.options)
        expect(result.headers.getSetCookie()).toEqual([
            'first=one; HttpOnly',
            'second=two; HttpOnly',
        ])
    })

    it('retains framework metadata and location on immutable redirects', () => {
        const original = Object.assign(
            Response.redirect('https://app.example.test/login', 303),
            { options: { href: '/login', statusCode: 303 } },
        )
        const result = addCspResponseHeadersService(original, context)
        expect(isRedirect(result)).toBe(true)
        expect(Reflect.get(result, 'options')).toBe(original.options)
        expect(result.status).toBe(303)
        expect(result.headers.get('location')).toBe(
            'https://app.example.test/login',
        )
        expect(result.headers.get('content-security-policy')).toBe(
            buildContentSecurityPolicyService(),
        )
    })

    it('forwards immutable streaming bodies without consuming them or losing cancellation', async () => {
        const cancel = vi.fn()
        let pulls = 0
        const body = new ReadableStream<Uint8Array>(
            {
                pull(controller) {
                    pulls++
                    controller.enqueue(
                        new TextEncoder().encode('Synthetic streamed chunk'),
                    )
                },
                cancel,
            },
            { highWaterMark: 0 },
        )
        const original = new Response(body, {
            status: 202,
            statusText: 'Accepted',
            headers: { 'content-type': 'text/html' },
        })
        const set = vi.spyOn(original.headers, 'set').mockImplementation(() => {
            throw new TypeError('immutable')
        })
        const result = addCspResponseHeadersService(original, context)
        set.mockRestore()
        expect(result.status).toBe(202)
        expect(result.statusText).toBe('Accepted')
        expect(result.bodyUsed).toBe(false)
        expect(pulls).toBe(0)
        const reader = result.body!.getReader()
        const first = await reader.read()
        expect(new TextDecoder().decode(first.value)).toBe(
            'Synthetic streamed chunk',
        )
        await reader.cancel('synthetic cancellation')
        expect(cancel).toHaveBeenCalledWith('synthetic cancellation')
        expect(result.headers.get('content-security-policy')).toBe(
            buildContentSecurityPolicyService(context),
        )
    })
})
