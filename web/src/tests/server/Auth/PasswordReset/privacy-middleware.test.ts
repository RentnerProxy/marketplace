import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { RequestServerResult } from '@tanstack/react-start'
import type { StorageMutationResponseOptions } from '@/server/Storage/Types/storage-mutation-barrier-response.types.ts'
import { createMiddleware } from '@tanstack/react-start'
import {
    createServerEntry,
    createStartHandler,
    getResponseHeaders,
} from '@tanstack/react-start/server'
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    isRedirect,
    redirect,
} from '@tanstack/react-router'

const events: Array<string> = []
const markerContext = { middlewareTest: 'preserve-next-context' }
const observedResults: Array<
    RequestServerResult<unknown, undefined, typeof markerContext>
> = []
const eventResponses: Array<{
    headers: ReturnType<typeof getResponseHeaders>
}> = []
const installFatalHandler = vi.fn()
const terminal = vi.fn(async function (_request: Request) {
    events.push('handler')
    return new Response('Synthetic page', {
        headers: { 'content-type': 'text/html' },
    })
})
const restoreGate = vi.fn(async function (
    _request: Request,
    _pathname: string,
): Promise<Response | null> {
    events.push('restore')
    return null
})
const barrier = vi.fn(async function (
    callback: () => Promise<unknown>,
    _options?: StorageMutationResponseOptions,
) {
    events.push('barrier')
    return callback()
})

class RestoreInProgressError extends Error {}
class StorageMutationBarrierUnavailableError extends Error {}

vi.mock('@/server/Admin/Backups/restore-request-gate.service.ts', () => ({
    getRestoreRequestGateResponse: restoreGate,
    isRestoreGateBypassPath: (pathname: string) =>
        pathname.startsWith('/assets/'),
}))
vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
    RestoreInProgressError,
    StorageMutationBarrierUnavailableError,
}))
vi.mock(
    '@/server/Storage/storage-mutation-barrier-response.service.ts',
    () => ({
        withSharedStorageMutationBarrierResponseService: barrier,
    }),
)
vi.mock('@/server/Storage/storage-mutation-barrier-health.service.ts', () => ({
    installStorageMutationBarrierFatalExitHandlerService: installFatalHandler,
}))

const { startInstance } = await import('@/start.ts')
const { requestMiddleware = [] } = await startInstance.getOptions()
const middlewareHandlers: Array<unknown> = requestMiddleware.map(
    (middleware) => {
        const handler = middleware.options.server
        if (!handler) throw new Error('Expected executable request middleware')
        return handler
    },
)

vi.mock('#tanstack-router-entry', () => ({
    getRouter() {
        throw new Error('The terminal middleware must handle the request')
    },
}))
vi.mock('#tanstack-start-plugin-adapters', () => ({
    hasPluginAdapters: false,
    pluginSerializationAdapters: [],
}))
vi.mock('tanstack-start-manifest:v', () => ({
    tsrStartManifest: () => ({ routes: {} }),
}))
vi.mock('#tanstack-start-entry', () => ({
    startInstance: {
        async getOptions() {
            return {
                requestMiddleware: [
                    ...requestMiddleware,
                    createMiddleware({ type: 'request' }).server(
                        ({ request }) => terminal(request),
                    ),
                ],
            }
        },
    },
}))
const frameworkEntry = createServerEntry({
    fetch: createStartHandler(() => {
        throw new Error('The renderer must not run')
    }),
})

function getMiddlewareHandler(index: number) {
    const handler = middlewareHandlers[index]
    if (typeof handler !== 'function') {
        throw new Error('Expected executable request middleware')
    }
    return handler
}

function readNextResult(
    result: unknown,
): RequestServerResult<unknown, undefined, typeof markerContext> {
    if (
        !result ||
        typeof result !== 'object' ||
        !('request' in result) ||
        !(result.request instanceof Request) ||
        !('pathname' in result) ||
        typeof result.pathname !== 'string' ||
        !('context' in result) ||
        result.context !== markerContext ||
        !('response' in result) ||
        !(result.response instanceof Response)
    ) {
        throw new Error('Middleware lost the typed next-result contract')
    }
    return {
        request: result.request,
        pathname: result.pathname,
        context: markerContext,
        response: result.response,
    }
}

async function dispatch(
    request: Request,
    handlerType: 'router' | 'serverFn' = 'router',
) {
    const handle = createServerEntry({
        async fetch(currentRequest) {
            const pathname = new URL(currentRequest.url).pathname
            let index = 0

            async function next(): Promise<
                RequestServerResult<unknown, undefined, typeof markerContext>
            > {
                const context = {
                    request: currentRequest,
                    pathname,
                    context: markerContext,
                }
                if (index === middlewareHandlers.length) {
                    return {
                        ...context,
                        response: await terminal(currentRequest),
                    }
                }
                const middleware = getMiddlewareHandler(index++)
                try {
                    const result: unknown = await middleware({
                        ...context,
                        handlerType,
                        next,
                    })
                    return result instanceof Response
                        ? { ...context, response: result }
                        : readNextResult(result)
                } catch (error) {
                    if (error instanceof Response)
                        return { ...context, response: error }
                    throw error
                }
            }

            try {
                const result = await next()
                observedResults.push(result)
                return result.response
            } finally {
                eventResponses.push({ headers: getResponseHeaders() })
            }
        },
    }).fetch
    return handle(request, {})
}

function expectPrivacy(headers: Pick<Headers, 'get'>) {
    expect(headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(headers.get('pragma')).toBe('no-cache')
    expect(headers.get('referrer-policy')).toBe('no-referrer')
}

function requestFor(path: string, method = 'GET', headers?: HeadersInit) {
    return new Request(`https://app.example.test${path}`, { method, headers })
}

beforeEach(() => {
    events.length = 0
    observedResults.length = 0
    eventResponses.length = 0
    terminal.mockReset().mockImplementation(async function () {
        events.push('handler')
        return new Response('Synthetic page', {
            headers: { 'content-type': 'text/html' },
        })
    })
    restoreGate.mockReset().mockImplementation(async function () {
        events.push('restore')
        return null
    })
    barrier.mockReset().mockImplementation(async function (callback) {
        events.push('barrier')
        return callback()
    })
})

describe('Start password-reset privacy middleware', () => {
    it('falls back to the request origin in development when ORIGIN is unset', async () => {
        const configuredOrigin = process.env.ORIGIN
        const development = process.env.DEV
        try {
            delete process.env.ORIGIN
            process.env.DEV = 'true'
            const send = (origin: string) =>
                dispatch(
                    requestFor('/_serverFn/synthetic', 'POST', { origin }),
                    'serverFn',
                )

            expect((await send('https://app.example.test')).status).toBe(200)
            expect((await send('https://other.example.test')).status).toBe(403)
            process.env.ORIGIN = 'https://configured.example.test'
            expect((await send('https://app.example.test')).status).toBe(403)
            expect((await send('https://configured.example.test')).status).toBe(
                200,
            )

            delete process.env.DEV
            delete process.env.ORIGIN
            expect((await send('https://app.example.test')).status).toBe(403)
            expect((await send('')).status).toBe(403)
        } finally {
            if (configuredOrigin === undefined) delete process.env.ORIGIN
            else process.env.ORIGIN = configuredOrigin
            if (development === undefined) delete process.env.DEV
            else process.env.DEV = development
        }
    })

    it('reconciles privacy, status and cookies through the real Start middleware pipeline', async () => {
        terminal.mockResolvedValueOnce(
            new Response('Synthetic framework body', {
                status: 202,
                headers: {
                    'cache-control': 'public, max-age=600',
                    'referrer-policy': 'unsafe-url',
                    'set-cookie': 'synthetic_first=1; HttpOnly',
                },
            }),
        )
        const response = await frameworkEntry.fetch(
            requestFor('/password-reset'),
            {},
        )
        expect(response.status).toBe(202)
        expectPrivacy(response.headers)
        expect(response.headers.getSetCookie()).toEqual([
            'synthetic_first=1; HttpOnly',
        ])
        expect(await response.text()).toBe('Synthetic framework body')
        expect(restoreGate).not.toHaveBeenCalled()
        expect(barrier).toHaveBeenCalledTimes(1)
    })

    it('applies privacy helper state to a real Start pipeline error response', async () => {
        terminal.mockRejectedValueOnce(new Error('Synthetic framework failure'))
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const response = await frameworkEntry.fetch(
                requestFor('/password-reset'),
                {},
            )
            expect(response.status).toBe(500)
            expectPrivacy(response.headers)
            expect(await response.json()).toMatchObject({
                status: 500,
                unhandled: true,
            })
        } finally {
            log.mockRestore()
        }
    })
    it('loads the real request middleware chain with the fatal handler replaced', () => {
        expect(middlewareHandlers).toHaveLength(4)
        expect(installFatalHandler).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['GET', '/password-reset'],
        ['HEAD', '/password-reset'],
        ['GET', '/Password-Reset'],
        ['HEAD', '/password-reset/'],
        ['GET', '/%70assword-reset'],
        ['HEAD', '//password-reset'],
        ['GET', '/PASSWORD-RESET///'],
    ])(
        'removes a legacy token before Restore or SSR for %s %s',
        async (method, path) => {
            restoreGate.mockResolvedValueOnce(
                new Response(null, { status: 503 }),
            )
            const response = await dispatch(
                requestFor(
                    `${path}?token=%20legacy%2Btoken%20&return=https%3A%2F%2Fforeign.example.test`,
                    method,
                ),
            )

            expect(response.status).toBe(303)
            expect(response.headers.get('location')).toBe(
                '/password-reset#token=legacy%2Btoken',
            )
            expect(await response.text()).toBe('')
            expectPrivacy(response.headers)
            expect(events).toEqual([])
            expect(restoreGate).not.toHaveBeenCalled()
            expect(barrier).not.toHaveBeenCalled()
            expect(terminal).not.toHaveBeenCalled()
        },
    )

    it.each(['token=first&%74oken=second', 'token=%E0%A4%A'])(
        'rejects malformed legacy input before all downstream work: %s',
        async (query) => {
            const response = await dispatch(
                requestFor(`/password-reset?${query}`),
            )
            expect(response.status).toBe(400)
            expect(response.headers.has('location')).toBe(false)
            expect(await response.text()).toBe('')
            expectPrivacy(response.headers)
            expect(restoreGate).not.toHaveBeenCalled()
            expect(barrier).not.toHaveBeenCalled()
            expect(terminal).not.toHaveBeenCalled()
        },
    )

    it.each([
        ['GET', '/password-reset', 'text/html'],
        ['HEAD', '/password-reset', '*/*'],
        ['GET', '/Password-Reset/', 'application/json'],
        ['GET', '/%70assword-reset', '*/*'],
        ['HEAD', '//password-reset', 'text/html'],
        ['GET', '/password-reset?language=de', 'text/html'],
    ])(
        'keeps normal processing and next context for %s %s',
        async (method, path, accept) => {
            const originalResponse = new Response('Synthetic reset page', {
                headers: {
                    'cache-control': 'public, max-age=600',
                    'referrer-policy': 'unsafe-url',
                },
            })
            terminal.mockResolvedValueOnce(originalResponse)
            const request = requestFor(path, method, { accept })
            const response = await dispatch(request)

            expect(response).toBe(originalResponse)
            expectPrivacy(response.headers)
            expectPrivacy(eventResponses[0].headers)
            expect(observedResults[0].request).toBe(request)
            expect(observedResults[0].pathname).toBe(
                new URL(request.url).pathname,
            )
            expect(observedResults[0].context).toBe(markerContext)
            expect(restoreGate).not.toHaveBeenCalled()
            expect(barrier).toHaveBeenCalledTimes(1)
            expect(barrier).toHaveBeenCalledWith(expect.any(Function), {
                signal: request.signal,
            })
            expect(terminal).toHaveBeenCalledTimes(1)
        },
    )

    it('preserves the existing Restore redirect on the following clean request', async () => {
        const restoreResponse = new Response(null, {
            status: 307,
            headers: {
                location: '/update-in-progress#return=%2Fpassword-reset',
                'retry-after': '3',
            },
        })
        barrier.mockRejectedValueOnce(new RestoreInProgressError())
        restoreGate.mockResolvedValueOnce(restoreResponse)
        const response = await dispatch(
            requestFor('/password-reset', 'GET', { accept: 'text/html' }),
        )

        expect(response).toBe(restoreResponse)
        expect(response.status).toBe(307)
        expect(response.headers.get('location')).toBe(
            '/update-in-progress#return=%2Fpassword-reset',
        )
        expect(response.headers.get('retry-after')).toBe('3')
        expectPrivacy(response.headers)
        expect(barrier).toHaveBeenCalledTimes(1)
        expect(restoreGate).toHaveBeenCalledTimes(1)
        expect(terminal).not.toHaveBeenCalled()
    })

    it.each([RestoreInProgressError, StorageMutationBarrierUnavailableError])(
        'keeps privacy on the Restore fallback after %p',
        async (Failure) => {
            barrier.mockRejectedValueOnce(new Failure())
            const response = await dispatch(requestFor('/password-reset'))
            expect(response.status).toBe(503)
            expect(response.headers.get('retry-after')).toBe('3')
            expectPrivacy(response.headers)
            expect(restoreGate).toHaveBeenCalledTimes(1)
            expect(terminal).not.toHaveBeenCalled()
        },
    )

    it.each(['same-origin', 'cross-site', 'missing'])(
        'keeps the actual CSRF policy for server-function POSTs with %s metadata',
        async (site) => {
            const headers = new Headers()
            if (site !== 'missing') headers.set('sec-fetch-site', site)
            const request = requestFor(
                '/_serverFn/opaque-function-id',
                'POST',
                headers,
            )
            const response = await dispatch(request, 'serverFn')

            expect(response.status).toBe(site === 'same-origin' ? 200 : 403)
            expectPrivacy(response.headers)
            expect(restoreGate).not.toHaveBeenCalled()
            expect(barrier).toHaveBeenCalledTimes(1)
            expect(terminal).toHaveBeenCalledTimes(
                site === 'same-origin' ? 1 : 0,
            )
            if (site === 'same-origin')
                expect(terminal).toHaveBeenCalledWith(request)
        },
    )

    it('protects a server-function method rejection without requiring function metadata', async () => {
        terminal.mockResolvedValueOnce(
            new Response(null, { status: 405, headers: { allow: 'POST' } }),
        )
        const response = await dispatch(
            requestFor('/_serverFn/opaque-function-id', 'GET', {
                'sec-fetch-site': 'same-origin',
            }),
            'serverFn',
        )
        expect(response.status).toBe(405)
        expect(response.headers.get('allow')).toBe('POST')
        expectPrivacy(response.headers)
    })

    it.each(['restore', 'barrier', 'handler'])(
        'preserves final error response privacy after a thrown %s failure',
        async (failureSource) => {
            const failure = new Error('Synthetic middleware failure')
            if (failureSource === 'restore') {
                barrier.mockRejectedValueOnce(new RestoreInProgressError())
                restoreGate.mockRejectedValueOnce(failure)
            } else if (failureSource === 'barrier')
                barrier.mockRejectedValueOnce(failure)
            else terminal.mockRejectedValueOnce(failure)
            const log = vi.spyOn(console, 'error').mockImplementation(() => {})
            try {
                const response = await dispatch(requestFor('/password-reset'))
                expect(response.status).toBe(500)
                expectPrivacy(response.headers)
                expectPrivacy(eventResponses[0].headers)
            } finally {
                log.mockRestore()
            }
        },
    )

    it('protects an unhandled server-function error through the actual Start error converter', async () => {
        terminal.mockRejectedValueOnce(new Error('Synthetic function failure'))
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const response = await dispatch(
                requestFor('/_serverFn/opaque-function-id', 'POST', {
                    'sec-fetch-site': 'same-origin',
                }),
                'serverFn',
            )
            expect(response.status).toBe(500)
            expectPrivacy(response.headers)
        } finally {
            log.mockRestore()
        }
    })

    it.each(['returned', 'thrown', 'immutable'])(
        'preserves and resolves real TanStack redirect metadata for a %s response',
        async (mode) => {
            const original = redirect({ to: '/setup' })
            const options = original.options
            if (mode === 'immutable') {
                vi.spyOn(original.headers, 'set').mockImplementation(() => {
                    throw new TypeError('Synthetic immutable response headers')
                })
            }
            if (mode === 'thrown') terminal.mockRejectedValueOnce(original)
            else terminal.mockResolvedValueOnce(original)
            const response = await dispatch(requestFor('/password-reset'))

            expect(isRedirect(response)).toBe(true)
            if (!isRedirect(response))
                throw new Error('Redirect metadata was lost')
            expect(Object.is(response.options, options)).toBe(true)
            expectPrivacy(response.headers)
            const root = createRootRoute()
            const setup = createRoute({
                getParentRoute: () => root,
                path: '/setup',
            })
            const router = createRouter({
                routeTree: root.addChildren([setup]),
                history: createMemoryHistory({
                    initialEntries: ['/password-reset'],
                }),
            })
            const resolved = router.resolveRedirect(response)
            expect(resolved.headers.get('location')).toBe('/setup')
            expectPrivacy(resolved.headers)
            expect(Object.is(response, original)).toBe(mode !== 'immutable')
        },
    )

    it('clones immutable response headers while preserving the exact stream body and cookies', async () => {
        const cancel = vi.fn()
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode('Synthetic streamed page'),
                )
                controller.close()
            },
            cancel,
        })
        const original = new Response(stream, {
            status: 202,
            statusText: 'Accepted',
        })
        original.headers.append('set-cookie', 'synthetic_a=1; HttpOnly')
        original.headers.append('set-cookie', 'synthetic_b=2; HttpOnly')
        const originalCookies = original.headers.getSetCookie()
        vi.spyOn(original.headers, 'set').mockImplementation(() => {
            throw new TypeError('Synthetic immutable response headers')
        })
        terminal.mockResolvedValueOnce(original)
        const response = await dispatch(requestFor('/password-reset'))

        expect(response).not.toBe(original)
        expect(response.body).toBe(original.body)
        expect(response.status).toBe(202)
        expect(response.statusText).toBe('Accepted')
        expect(response.headers.getSetCookie()).toEqual(originalCookies)
        expectPrivacy(response.headers)
        expect(cancel).not.toHaveBeenCalled()
        expect(await response.text()).toBe('Synthetic streamed page')
        expect(cancel).not.toHaveBeenCalled()
    })

    it('also protects a Response rejected directly by next()', async () => {
        const failure = new Response(null, {
            status: 429,
            headers: { 'retry-after': '12' },
        })
        const handle = createServerEntry({
            async fetch(request) {
                const middleware = getMiddlewareHandler(1)
                const result: unknown = await middleware({
                    request,
                    pathname: '/password-reset',
                    handlerType: 'router',
                    context: markerContext,
                    next: async () => {
                        throw failure
                    },
                })
                return result instanceof Response
                    ? result
                    : readNextResult(result).response
            },
        }).fetch
        const response = await handle(requestFor('/password-reset'), {})
        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('12')
        expectPrivacy(response.headers)
    })

    it.each(['/assets/app.js?token=unrelated', '/about?language=de'])(
        'preserves unrelated cache policy at %s',
        async (path) => {
            const original = new Response('Synthetic public content', {
                headers: {
                    'cache-control': 'public, max-age=31536000, immutable',
                    'referrer-policy': 'strict-origin-when-cross-origin',
                },
            })
            terminal.mockResolvedValueOnce(original)
            const response = await dispatch(requestFor(path))

            expect(response).toBe(original)
            expect(response.headers.get('cache-control')).toBe(
                'public, max-age=31536000, immutable',
            )
            expect(response.headers.get('referrer-policy')).toBe(
                'strict-origin-when-cross-origin',
            )
            expect(response.headers.has('pragma')).toBe(false)
            expect(eventResponses[0].headers.has('cache-control')).toBe(false)
            expect(restoreGate).not.toHaveBeenCalled()
            expect(terminal).toHaveBeenCalledTimes(1)
        },
    )

    it.each(['/setup', '/setup/', '/%73etup'])(
        'keeps the bootstrap page at %s private and out of search results',
        async (path) => {
            const response = await frameworkEntry.fetch(requestFor(path), {})
            expect(response.status).toBe(200)
            expectPrivacy(response.headers)
            expect(response.headers.get('x-robots-tag')).toBe(
                'noindex, nofollow, nosnippet',
            )
        },
    )

    it.each([
        '/login',
        '/register',
        '/admin/users',
        '/user/catalog',
        '/blog/unpublished',
    ])('prevents indexing nonpublic or unknown content at %s', async (path) => {
        const response = await frameworkEntry.fetch(requestFor(path), {})
        expect(response.headers.get('x-robots-tag')).toBe(
            'noindex, nofollow, nosnippet',
        )
    })

    it('allows a successful public page while excluding its error response', async () => {
        const response = await frameworkEntry.fetch(requestFor('/apps'), {})
        expect(response.headers.get('x-robots-tag')).toBe(
            'index, follow, max-image-preview:large',
        )
        terminal.mockResolvedValueOnce(
            new Response('Synthetic unavailable page', { status: 503 }),
        )
        const unavailable = await frameworkEntry.fetch(requestFor('/apps'), {})
        expect(unavailable.status).toBe(503)
        expect(unavailable.headers.get('x-robots-tag')).toBe(
            'noindex, nofollow, nosnippet',
        )
    })

    it('marks an unhandled public-page failure noindex through the actual Start error converter', async () => {
        terminal.mockRejectedValueOnce(
            new Error('Synthetic public-page failure'),
        )
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const response = await frameworkEntry.fetch(requestFor('/'), {})
            expect(response.status).toBe(500)
            expect(response.headers.get('x-robots-tag')).toBe(
                'noindex, nofollow, nosnippet',
            )
        } finally {
            log.mockRestore()
        }
    })
})
