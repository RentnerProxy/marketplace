import { describe, expect, it } from 'bun:test'
import {
    CSP_MAX_WEBSOCKET_URL_LENGTH,
    CSP_NONCE_PATTERN,
    CSP_SECURITY_CONFIG,
    DEFAULT_SECURITY_HEADERS,
} from '@/config/security-headers.config.ts'
import {
    buildContentSecurityPolicyService,
    getCurrentCspNonceService,
    validateNonceContentSecurityPolicyService,
    withRequestCspContextService,
} from '@/server/Security/csp.service.ts'

const websocketOrigin = 'wss://realtime.example.test'
const nonce = Buffer.alloc(32, 3).toString('base64url')
const context = { nonce, websocketOrigin }

function directives(policy: string) {
    return new Map(
        policy.split('; ').map((directive) => {
            const [name, ...sources] = directive.split(' ')
            return [name, sources] as const
        }),
    )
}

describe('request content security policies', function () {
    it('keeps fallback documents script-free while retaining CSS and existing security headers', function () {
        const policy = buildContentSecurityPolicyService()
        const parsed = directives(policy)
        expect(parsed.get('script-src')).toEqual(["'none'"])
        expect(parsed.get('script-src-attr')).toEqual(["'none'"])
        expect(parsed.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
        expect(parsed.get('connect-src')).toEqual(["'self'"])
        expect(policy).not.toContain("'unsafe-eval'")
        expect(policy).not.toContain("'nonce-")
        expect(
            validateNonceContentSecurityPolicyService(policy, websocketOrigin),
        ).toBe(false)
        expect(DEFAULT_SECURITY_HEADERS['x-content-type-options']).toBe(
            'nosniff',
        )
        expect(DEFAULT_SECURITY_HEADERS['x-frame-options']).toBe('DENY')
    })

    it.each([
        'wss://realtime.example.test',
        'wss://realtime.example.test:8443',
        'ws://localhost:3001',
        'ws://127.0.0.1:3001',
        'wss://xn--bcher-kva.example',
    ])(
        'builds one canonical policy for an exact configured origin',
        function (origin) {
            const policy = buildContentSecurityPolicyService({
                nonce,
                websocketOrigin: origin,
            })
            const parsed = directives(policy)
            expect(parsed.get('script-src')).toEqual([
                "'self'",
                "'nonce-" + nonce + "'",
            ])
            expect(parsed.get('script-src-attr')).toEqual(["'none'"])
            expect(parsed.get('connect-src')).toEqual([
                "'self'",
                origin,
                ...CSP_SECURITY_CONFIG.connectOrigins,
            ])
            expect(parsed.size).toBe(policy.split('; ').length)
            expect(
                validateNonceContentSecurityPolicyService(policy, origin),
            ).toBe(true)
            expect(
                validateNonceContentSecurityPolicyService(
                    policy,
                    'wss://different.example.test',
                ),
            ).toBe(false)
        },
    )

    it('uses a canonical 32-byte Base64URL pattern including padding-bit checks', function () {
        const alphabet =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
        let accepted = 0
        for (const last of alphabet) {
            const value = 'A'.repeat(42) + last
            const decoded = Buffer.from(value, 'base64url')
            const canonical =
                decoded.length === 32 && decoded.toString('base64url') === value
            expect(CSP_NONCE_PATTERN.test(value)).toBe(canonical)
            if (canonical) accepted += 1
        }
        expect(accepted).toBe(16)
    })

    it.each([
        '',
        'A',
        'A'.repeat(42),
        'A'.repeat(44),
        'A'.repeat(42) + 'B',
        'A'.repeat(42) + '=',
        'A'.repeat(42) + '/',
        'A'.repeat(42) + '+',
        nonce + '\n',
        nonce + '\r',
        nonce + '\r\n',
        nonce + '\u2028',
        nonce + '\u2029',
        nonce + "'; script-src *",
    ])(
        'rejects noncanonical nonce strings and trailing line terminators',
        function (value) {
            expect(CSP_NONCE_PATTERN.test(value)).toBe(false)
            expect(() =>
                buildContentSecurityPolicyService({
                    nonce: value,
                    websocketOrigin,
                }),
            ).toThrow()
            const malformed = buildContentSecurityPolicyService(
                context,
            ).replace(nonce, value)
            expect(
                validateNonceContentSecurityPolicyService(
                    malformed,
                    websocketOrigin,
                ),
            ).toBe(false)
        },
    )

    it.each([
        '',
        'https://realtime.example.test',
        'wss:',
        'wss://*.example.test',
        'wss://realtime.example.test/',
        'wss://realtime.example.test/path',
        'wss://realtime.example.test?query=1',
        'wss://realtime.example.test#fragment',
        'wss://user:pass@realtime.example.test',
        'wss://realtime.example.test:443',
        'wss://REALTIME.example.test',
        'wss://realtime.example.test ',
        'wss://realtime.example.test;script-src',
        'wss://realtime.example.test,example.test',
        'wss://realtime.example.test\n',
        'wss://realtime.example.test\\path',
    ])(
        'rejects noncanonical or injectable origin strings before entering a context',
        function (origin) {
            let entered = false
            expect(() =>
                withRequestCspContextService(origin, () => {
                    entered = true
                }),
            ).toThrow()
            expect(entered).toBe(false)
            expect(() =>
                buildContentSecurityPolicyService({
                    nonce,
                    websocketOrigin: origin,
                }),
            ).toThrow()
            expect(
                validateNonceContentSecurityPolicyService(
                    buildContentSecurityPolicyService(context),
                    origin,
                ),
            ).toBe(false)
        },
    )

    it('bounds policy and origin inputs before parsing', function () {
        expect(
            validateNonceContentSecurityPolicyService(
                'x'.repeat(CSP_SECURITY_CONFIG.maximumPolicyLength + 1),
                websocketOrigin,
            ),
        ).toBe(false)
        expect(() =>
            withRequestCspContextService(
                'wss://' + 'x'.repeat(CSP_MAX_WEBSOCKET_URL_LENGTH),
                () => undefined,
            ),
        ).toThrow()
    })

    it.each(
        [null, undefined, 1, true, {}, [], new String('policy')].map(
            (policy) => ({ policy }),
        ),
    )(
        'rejects non-string outer response policies without coercion',
        function ({ policy }) {
            expect(
                validateNonceContentSecurityPolicyService(
                    policy,
                    websocketOrigin,
                ),
            ).toBe(false)
        },
    )

    it('rejects widened, duplicated, reordered or combined policies', function () {
        const policy = buildContentSecurityPolicyService(context)
        const variants = [
            policy + '; script-src *',
            policy + '; connect-src *',
            policy + '; report-uri https://report.example.test',
            policy + ', ' + policy,
            policy.replace(
                "script-src 'self'",
                "script-src 'self' 'unsafe-inline'",
            ),
            policy.replace(
                "script-src 'self'",
                "script-src 'self' 'unsafe-eval'",
            ),
            policy.replace(websocketOrigin, 'wss:'),
            policy.replace(websocketOrigin, 'ws: wss:'),
            policy.replace(websocketOrigin, 'wss://*.example.test'),
            policy.replace(
                "script-src-attr 'none'",
                "script-src-attr 'unsafe-inline'",
            ),
            policy.replace("default-src 'self'", 'default-src *'),
            policy.split('; ').toReversed().join('; '),
            policy + ';',
            policy + '\n',
            ' ' + policy,
        ]
        for (const value of variants)
            expect(
                validateNonceContentSecurityPolicyService(
                    value,
                    websocketOrigin,
                ),
            ).toBe(false)
    })

    it('isolates concurrent asynchronous requests with fresh unmodifiable nonces', async function () {
        expect(() => getCurrentCspNonceService()).toThrow()
        const values = await Promise.all(
            Array.from({ length: 200 }, (_, index) =>
                withRequestCspContextService(
                    websocketOrigin,
                    async function (current) {
                        expect(Object.isFrozen(current)).toBe(true)
                        expect(Reflect.set(current, 'nonce', nonce)).toBe(false)
                        expect(getCurrentCspNonceService()).toBe(current.nonce)
                        await Promise.resolve()
                        if (index % 2 === 0)
                            await new Promise<void>((resolve) =>
                                setImmediate(resolve),
                            )
                        expect(getCurrentCspNonceService()).toBe(current.nonce)
                        expect(CSP_NONCE_PATTERN.test(current.nonce)).toBe(true)
                        expect(
                            Buffer.from(current.nonce, 'base64url').length,
                        ).toBe(32)
                        return current.nonce
                    },
                ),
            ),
        )
        expect(new Set(values).size).toBe(values.length)
        expect(() => getCurrentCspNonceService()).toThrow()
    })

    it('restores an enclosing context after nested synchronous and asynchronous failures', async function () {
        const synchronous = new Error('Synthetic callback failure')
        const asynchronous = new Error('Synthetic async failure')
        await withRequestCspContextService(
            websocketOrigin,
            async function (outer) {
                expect(() =>
                    withRequestCspContextService(
                        websocketOrigin,
                        function (inner) {
                            expect(inner.nonce).not.toBe(outer.nonce)
                            expect(getCurrentCspNonceService()).toBe(
                                inner.nonce,
                            )
                            throw synchronous
                        },
                    ),
                ).toThrow(synchronous)
                expect(getCurrentCspNonceService()).toBe(outer.nonce)
                await expect(
                    withRequestCspContextService(
                        websocketOrigin,
                        async function (inner) {
                            await Promise.resolve()
                            expect(getCurrentCspNonceService()).toBe(
                                inner.nonce,
                            )
                            throw asynchronous
                        },
                    ),
                ).rejects.toBe(asynchronous)
                expect(getCurrentCspNonceService()).toBe(outer.nonce)
            },
        )
        expect(() => getCurrentCspNonceService()).toThrow()
    })

    it('preserves callback return values and thrown redirect objects exactly', function () {
        const response = new Response(null, {
            status: 303,
            headers: { location: '/login' },
        })
        expect(
            withRequestCspContextService(websocketOrigin, () => response),
        ).toBe(response)
        let caught: unknown
        try {
            withRequestCspContextService(websocketOrigin, () => {
                throw response
            })
        } catch (error) {
            caught = error
        }
        expect(caught).toBe(response)
        expect(() => getCurrentCspNonceService()).toThrow()
    })

    it('retains each request context for deferred streaming work consumed outside it', async function () {
        const releases = Array.from({ length: 20 }, () =>
            Promise.withResolvers<void>(),
        )
        const outputs = releases.map((release) =>
            withRequestCspContextService(websocketOrigin, (current) => ({
                nonce: current.nonce,
                response: new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            void release.promise
                                .then(() => {
                                    controller.enqueue(
                                        new TextEncoder().encode(
                                            getCurrentCspNonceService(),
                                        ),
                                    )
                                    return controller.close()
                                })
                                .catch((error) => controller.error(error))
                        },
                    }),
                ),
            })),
        )
        expect(() => getCurrentCspNonceService()).toThrow()
        for (const release of releases.toReversed()) release.resolve()
        const values = await Promise.all(
            outputs.map((output) => output.response.text()),
        )
        expect(values).toEqual(outputs.map((output) => output.nonce))
        expect(new Set(values).size).toBe(outputs.length)
        expect(() => getCurrentCspNonceService()).toThrow()
    })
})
