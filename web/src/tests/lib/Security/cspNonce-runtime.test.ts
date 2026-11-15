import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

const runtime: { side: 'server' | 'client' } = { side: 'server' }
const nonce = Buffer.alloc(32, 7).toString('base64url')
const serverNonce = vi.fn(() => nonce)
const query = vi.fn((_selector: string): Array<{ content: string }> => [
    { content: nonce },
])
vi.mock('@/server/Security/csp.service.ts', () => ({
    getCurrentCspNonceService: serverNonce,
}))
vi.mock('@tanstack/react-start', () => ({
    createIsomorphicFn: () => ({
        server: (server: () => string) => ({
            client: (client: () => string) => () =>
                runtime.side === 'server' ? server() : client(),
        }),
    }),
}))
const { getRouterCspNonce } = await import('@/lib/Security/cspNonce.ts')

beforeEach(function () {
    vi.clearAllMocks()
    runtime.side = 'server'
    query.mockReturnValue([{ content: nonce }])
    stubTestGlobal('document', { querySelectorAll: query })
})
afterEach(restoreTestGlobals)

describe('isomorphic CSP nonce acquisition', function () {
    it('gets the request-scoped server nonce without consulting DOM metadata', function () {
        expect(getRouterCspNonce()).toBe(nonce)
        expect(serverNonce).toHaveBeenCalledTimes(1)
        expect(query).not.toHaveBeenCalled()
    })

    it('reads exactly the nonce meta selector on the browser side', function () {
        runtime.side = 'client'
        expect(getRouterCspNonce()).toBe(nonce)
        expect(query).toHaveBeenCalledWith('meta[property="csp-nonce"]')
        expect(serverNonce).not.toHaveBeenCalled()
    })

    it.each(
        [
            [],
            [{ content: nonce }, { content: nonce }],
            [{ content: nonce + '; script-src *' }],
        ].map((elements) => ({ elements })),
    )(
        'fails closed for missing, duplicate or injected browser metadata',
        function ({ elements }) {
            runtime.side = 'client'
            query.mockReturnValue(elements)
            expect(getRouterCspNonce).toThrow(
                'Die CSP-Kennung des Dokuments fehlt oder ist ungültig.',
            )
            expect(serverNonce).not.toHaveBeenCalled()
        },
    )
})
