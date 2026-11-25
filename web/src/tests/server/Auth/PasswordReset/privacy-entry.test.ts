import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    createServerEntry,
    handleStartError,
    setResponseHeader,
} from '@tanstack/react-start/server'
import { applyPasswordResetPrivacyHeadersService } from '@/server/Auth/PasswordReset/privacy.service.ts'
import type { ServerEntry } from '@tanstack/react-start/server-entry'
import { CSP_NONCE_PATTERN } from '@/config/security-headers.config.ts'
import { getCurrentCspNonceService } from '@/server/Security/csp.service.ts'

const streamCallback = vi.fn(() => new Response('Synthetic renderer'))
const delegate = vi.fn(async function (
    ..._args: Parameters<ServerEntry['fetch']>
) {
    return new Response('Synthetic Start response')
})
const createHandler = vi.fn(function (_callback: typeof streamCallback) {
    return delegate
})
const loadAppStart = vi.fn(function () {
    throw new Error('The privacy entry must not load application middleware')
})
const loadDefaultServerEntry = vi.fn(function () {
    throw new Error(
        'The privacy entry must not initialize the default server entry',
    )
})

vi.mock('@tanstack/react-start/server', () => ({
    createServerEntry,
    handleStartError,
    createStartHandler: createHandler,
    defaultStreamHandler: streamCallback,
}))
vi.mock('@tanstack/react-start/server-entry', loadDefaultServerEntry)
vi.mock('@/start.ts', loadAppStart)

const { default: entry } = await import('@/server.ts')
const factoriesDuringImport = createHandler.mock.calls.length

function requestFor(path: string, method = 'GET') {
    return new Request(`https://app.example.test${path}`, { method })
}

function expectPrivacy(response: Response) {
    expect(response.headers.get('cache-control')).toBe(
        'private, no-store, max-age=0',
    )
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('pragma')).toBe('no-cache')
}

const originalOrigin = process.env.ORIGIN
const originalRealtimeUrl = process.env.VITE_REALTIME_WS_URL

beforeEach(() => {
    process.env.ORIGIN = 'https://app.example.test'
    process.env.VITE_REALTIME_WS_URL = ''
    createHandler.mockClear()
    delegate.mockReset().mockImplementation(async function () {
        return new Response('Synthetic Start response')
    })
    streamCallback.mockClear()
})

afterEach(() => {
    if (originalOrigin === undefined) delete process.env.ORIGIN
    else process.env.ORIGIN = originalOrigin
    if (originalRealtimeUrl === undefined)
        delete process.env.VITE_REALTIME_WS_URL
    else process.env.VITE_REALTIME_WS_URL = originalRealtimeUrl
})

describe('password-reset privacy before the Start server entry', () => {
    it('imports only the custom fetch contract without initializing Start', () => {
        expect(typeof entry.fetch).toBe('function')
        expect(factoriesDuringImport).toBe(0)
        expect(loadAppStart).not.toHaveBeenCalled()
        expect(loadDefaultServerEntry).not.toHaveBeenCalled()
    })

    it.each([
        ['GET', '/password-reset'],
        ['HEAD', '/password-reset'],
        ['GET', '//password-reset'],
        ['HEAD', '///PASSWORD-RESET///'],
        ['GET', '/%70assword-reset'],
        ['GET', '/Password-Reset/'],
    ])(
        'returns the first response as a private 303 for %s %s',
        async (method, path) => {
            delegate.mockRejectedValueOnce(
                new Error('Start must never receive a legacy token'),
            )
            const request = requestFor(
                `${path}?token=%20synthetic%2Btoken%20&return=https%3A%2F%2Fforeign.example.test`,
                method,
            )
            const response = await entry.fetch(request, undefined)

            expect(response.status).toBe(303)
            expect(response.headers.get('location')).toBe(
                '/password-reset#token=synthetic%2Btoken',
            )
            expect(await response.text()).toBe('')
            expectPrivacy(response)
            expect(createHandler).not.toHaveBeenCalled()
            expect(delegate).not.toHaveBeenCalled()
            expect(streamCallback).not.toHaveBeenCalled()
            expect(loadAppStart).not.toHaveBeenCalled()
            expect(loadDefaultServerEntry).not.toHaveBeenCalled()
        },
    )

    it.each([
        'token=',
        'token=first&%74oken=second',
        'token=%E0%A4%A',
        `token=${'x'.repeat(256)}`,
    ])(
        'returns a private 400 before normalization for malformed legacy input: %s',
        async (query) => {
            const response = await entry.fetch(
                requestFor(`//password-reset?${query}`),
                undefined,
            )
            expect(response.status).toBe(400)
            expect(response.headers.has('location')).toBe(false)
            expect(await response.text()).toBe('')
            expectPrivacy(response)
            expect(createHandler).not.toHaveBeenCalled()
            expect(delegate).not.toHaveBeenCalled()
            expect(loadAppStart).not.toHaveBeenCalled()
        },
    )

    it('secures a Start handler initialization failure before any handler is cached', async () => {
        createHandler.mockImplementationOnce(() => {
            throw new Error('Synthetic Start initialization failure')
        })
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const response = await entry.fetch(
                requestFor('/password-reset'),
                undefined,
            )
            expect(response.status).toBe(500)
            expectPrivacy(response)
            expect(response.headers.get('content-security-policy')).toContain(
                "script-src 'none'",
            )
            expect(delegate).not.toHaveBeenCalled()
        } finally {
            log.mockRestore()
        }
    })

    it('initializes one Start handler lazily and reuses it for simultaneous requests', async () => {
        const first = new Response('First synthetic result')
        const second = new Response('Second synthetic result')
        delegate.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
        const firstRequest = requestFor('/about')
        const secondRequest = requestFor('/about?language=de')

        const responses = await Promise.all([
            entry.fetch(firstRequest, undefined),
            entry.fetch(secondRequest, undefined),
        ])

        expect(createHandler).toHaveBeenCalledTimes(1)
        expect(createHandler).toHaveBeenCalledWith(streamCallback)
        expect(delegate).toHaveBeenCalledTimes(2)
        expect(delegate.mock.calls[0][0]).toBe(firstRequest)
        expect(delegate.mock.calls[1][0]).toBe(secondRequest)
        expect(responses[0]).toBe(first)
        expect(responses[1]).toBe(second)
        expect(streamCallback).not.toHaveBeenCalled()
        expect(loadAppStart).not.toHaveBeenCalled()
        expect(loadDefaultServerEntry).not.toHaveBeenCalled()
    })

    it('forwards the exact request, options, body and abort signal to Start', async () => {
        const controller = new AbortController()
        const request = new Request(
            'https://app.example.test/_serverFn/opaque',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'sec-fetch-site': 'same-origin',
                },
                body: JSON.stringify({ token: 'synthetic-body-token' }),
                signal: controller.signal,
            },
        )
        const options = {
            context: { nonce: 'synthetic-test-nonce' },
            inlineCss: false,
            responseLinkHeader: false,
        } satisfies Parameters<ServerEntry['fetch']>[1]
        const original = new Response('Synthetic function response', {
            status: 202,
            headers: { 'x-synthetic-response': 'preserved' },
        })
        delegate.mockResolvedValueOnce(original)

        const response = await entry.fetch(request, options)

        expect(response).toBe(original)
        expect(delegate).toHaveBeenCalledTimes(1)
        expect(delegate.mock.calls[0][0]).toBe(request)
        expect(Object.is(delegate.mock.calls[0][1], options)).toBe(true)
        expect(delegate.mock.calls[0][0].signal).toBe(request.signal)
        expect(request.bodyUsed).toBe(false)
        expect(await request.json()).toEqual({ token: 'synthetic-body-token' })
        expect(response.headers.get('x-synthetic-response')).toBe('preserved')
    })

    it.each([
        '/password-reset',
        '//password-reset',
        '/%70assword-reset',
        '/Password-Reset/',
    ])(
        'protects early framework redirects for a clean reset path: %s',
        async (path) => {
            const original = Response.redirect(
                'https://app.example.test/password-reset',
                308,
            )
            delegate.mockResolvedValueOnce(original)

            const response = await entry.fetch(requestFor(path), undefined)

            expect(delegate).toHaveBeenCalledTimes(1)
            expect(response.status).toBe(308)
            expect(response.headers.get('location')).toBe(
                'https://app.example.test/password-reset',
            )
            expect(await response.text()).toBe('')
            expectPrivacy(response)
        },
    )

    it.each([200, 400, 503])(
        'protects clean reset responses from Start with status %s',
        async (status) => {
            const original = new Response('Synthetic response', {
                status,
                headers: {
                    'cache-control': 'public, max-age=600',
                    'retry-after': '3',
                },
            })
            delegate.mockResolvedValueOnce(original)
            const response = await entry.fetch(
                requestFor('/password-reset?language=de'),
                undefined,
            )

            expect(response).toBe(original)
            expect(response.status).toBe(status)
            expect(response.headers.get('retry-after')).toBe('3')
            expectPrivacy(response)
        },
    )

    it.each([
        '/assets/app.js',
        '/password-reset-other?token=unrelated',
        '/about',
    ])('preserves unrelated responses and cache policy at %s', async (path) => {
        const original = new Response('Synthetic cached result', {
            headers: {
                'cache-control': 'public, max-age=31536000, immutable',
                'referrer-policy': 'strict-origin-when-cross-origin',
            },
        })
        delegate.mockResolvedValueOnce(original)

        const response = await entry.fetch(requestFor(path), undefined)

        expect(response).toBe(original)
        expect(response.headers.get('cache-control')).toBe(
            'public, max-age=31536000, immutable',
        )
        expect(response.headers.get('referrer-policy')).toBe(
            'strict-origin-when-cross-origin',
        )
        expect(response.headers.has('pragma')).toBe(false)
    })

    it.each(['/about', '/password-reset', '/_serverFn/opaque'])(
        'secures the final Start error response at %s',
        async (path) => {
            delegate.mockImplementationOnce(async function () {
                applyPasswordResetPrivacyHeadersService({
                    set: setResponseHeader,
                })
                setResponseHeader('set-cookie', 'synthetic_error=1; HttpOnly')
                throw new Error('Synthetic Start failure')
            })
            const log = vi.spyOn(console, 'error').mockImplementation(() => {})
            try {
                const response = await entry.fetch(requestFor(path), undefined)
                expect(response.status).toBe(500)
                expectPrivacy(response)
                expect(
                    response.headers.get('content-security-policy'),
                ).toContain("script-src 'none'")
                expect(response.headers.getSetCookie()).toEqual([
                    'synthetic_error=1; HttpOnly',
                ])
                expect(await response.json()).toMatchObject({
                    status: 500,
                    unhandled: true,
                })
                expect(delegate).toHaveBeenCalledTimes(1)
            } finally {
                log.mockRestore()
            }
        },
    )

    it('keeps a thrown middleware Response with status, cookies, privacy and CSP', async () => {
        const failure = new Response('Synthetic throttled response', {
            status: 429,
            headers: {
                'retry-after': '12',
                'set-cookie': 'synthetic_limit=1; HttpOnly',
            },
        })
        delegate.mockRejectedValueOnce(failure)
        const response = await entry.fetch(
            requestFor('/password-reset'),
            undefined,
        )
        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('12')
        expect(response.headers.getSetCookie()).toEqual([
            'synthetic_limit=1; HttpOnly',
        ])
        expectPrivacy(response)
        expect(response.headers.get('content-security-policy')).toContain(
            "script-src 'none'",
        )
        expect(await response.text()).toBe('Synthetic throttled response')
    })

    it('binds simultaneous SSR bodies to distinct server-generated nonces', async () => {
        process.env.VITE_REALTIME_WS_URL = 'wss://realtime.example.test/socket'
        delegate.mockImplementation(async function () {
            const nonce = getCurrentCspNonceService()
            await Promise.resolve()
            expect(getCurrentCspNonceService()).toBe(nonce)
            return new Response(nonce, {
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'cache-control': 'public, max-age=3600',
                },
            })
        })
        const request = new Request('https://app.example.test/about', {
            headers: {
                'x-csp-nonce': 'attacker-controlled-value',
                'content-security-policy': "script-src * 'unsafe-inline'",
            },
        })
        const options = { context: { nonce: 'caller-controlled-value' } }
        const results = await Promise.all([
            entry.fetch(request, options),
            entry.fetch(requestFor('/about?second=1'), undefined),
        ])
        const nonces = await Promise.all(results.map((result) => result.text()))
        expect(nonces[0]).not.toBe(nonces[1])
        for (let index = 0; index < results.length; index++) {
            const nonce = nonces[index]
            const result = results[index]
            expect(CSP_NONCE_PATTERN.test(nonce)).toBe(true)
            expect(nonce).not.toBe('attacker-controlled-value')
            expect(nonce).not.toBe('caller-controlled-value')
            expect(result.headers.get('content-security-policy')).toContain(
                `'nonce-${nonce}'`,
            )
            expect(result.headers.get('content-security-policy')).toContain(
                'wss://realtime.example.test',
            )
            expect(result.headers.get('cache-control')).toBe(
                'private, no-store, max-age=0',
            )
        }
        expect(() => getCurrentCspNonceService()).toThrow()
    })

    it('protects reset documents with both their nonce and the stronger referrer policy', async () => {
        delegate.mockImplementation(async function () {
            return new Response(getCurrentCspNonceService(), {
                headers: { 'content-type': 'text/html' },
            })
        })
        const response = await entry.fetch(
            requestFor('/password-reset'),
            undefined,
        )
        const nonce = await response.text()
        expectPrivacy(response)
        expect(response.headers.get('content-security-policy')).toContain(
            `'nonce-${nonce}'`,
        )
    })

    it('keeps legacy redirect handling independent of the app configuration and nonce context', async () => {
        delete process.env.ORIGIN
        const response = await entry.fetch(
            requestFor('/password-reset?token=synthetic'),
            undefined,
        )
        expectPrivacy(response)
        expect(response.status).toBe(303)
        expect(response.headers.get('content-security-policy')).toContain(
            "script-src 'none'",
        )
        expect(delegate).not.toHaveBeenCalled()
        expect(() => getCurrentCspNonceService()).toThrow()
    })
})
