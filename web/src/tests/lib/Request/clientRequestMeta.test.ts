import { afterAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import { logWarn } from '@/server/Logging/logger.ts'
import {
    getClientIp,
    getClientRequestMeta,
} from '@/lib/Request/clientRequestMeta.ts'

const requestHeaderMock = (function () {
    return vi.fn<(name: string) => string | undefined>()
})()

const valkeyMock = (function () {
    return {
        get: vi.fn(async function (_key: string) {
            return null as string | null
        }),
        set: vi.fn(async function (
            _key: string,
            _value: string,
            _mode: 'EX',
            _ttl: number,
        ) {
            return 'OK'
        }),
    }
})()

vi.mock('@tanstack/react-start/server', function () {
    return { getRequestHeader: requestHeaderMock }
})

vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getValkeyConnection: vi.fn(function () {
            return valkeyMock
        }),
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logWarn: vi.fn() }
})

const originalEnvironment = {
    INTERNAL_PROXY_SECRET: process.env.INTERNAL_PROXY_SECRET,
    VALKEY_URL: process.env.VALKEY_URL,
}

function setHeaders(headers: Record<string, string | undefined>) {
    requestHeaderMock.mockImplementation(function (name) {
        return headers[name]
    })
}

describe('Client-Request-Metadaten', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        delete process.env.INTERNAL_PROXY_SECRET
        delete process.env.VALKEY_URL
        setHeaders({})
        valkeyMock.get.mockResolvedValue(null)
    })

    afterAll(function () {
        Object.assign(process.env, originalEnvironment)
        restoreTestGlobals()
    })

    it('vertraut Client-IPs nur mit passendem internem Proxy-Secret', function () {
        setHeaders({ 'x-app-client-ip': '203.0.113.8' })
        expect(getClientIp()).toBeNull()

        process.env.INTERNAL_PROXY_SECRET = 'intern'
        expect(getClientIp()).toBeNull()

        setHeaders({
            'x-app-proxy-secret': 'falsch',
            'x-app-client-ip': '203.0.113.8',
        })
        expect(getClientIp()).toBeNull()

        setHeaders({
            'x-app-proxy-secret': 'intern',
            'x-app-client-ip': ' kein-ip ',
        })
        expect(getClientIp()).toBeNull()

        setHeaders({
            'x-app-proxy-secret': 'intern',
            'x-app-client-ip': ' 2001:db8::1 ',
        })
        expect(getClientIp()).toBe('2001:db8::1')
    })

    it.each([
        ['Mozilla Edg/123 Windows NT', 'Microsoft Edge', 'Windows'],
        ['Mozilla Firefox/123 Mac OS X', 'Firefox', 'macOS'],
        ['Mozilla Chrome/123 Android', 'Chrome', 'Android'],
        ['Mozilla Safari/123 iPhone', 'Safari', 'iPhone (iOS)'],
        ['Mozilla OPR/123 iPad', 'Opera', 'iPad (iOS)'],
        ['Crawler Linux', 'Crawler Linux', 'Linux'],
        ['Custom Mobile', 'Custom Mobile', 'Mobile'],
        ['Custom Agent', 'Custom Agent', 'Desktop'],
        ['', null, null],
    ])(
        'ordnet %s einem Browser und Gerät zu',
        async function (userAgent, browser, device) {
            setHeaders({ 'user-agent': userAgent })

            await expect(getClientRequestMeta()).resolves.toEqual({
                ip: null,
                browser,
                device,
                location: null,
            })
        },
    )

    it('begrenzt unbekannte User-Agent-Labels', async function () {
        setHeaders({ 'user-agent': 'X'.repeat(300) })

        const result = await getClientRequestMeta()

        expect(result.browser).toHaveLength(255)
        expect(result.device).toBe('Desktop')
    })

    it('liest positive und negative Standorttreffer aus Valkey', async function () {
        process.env.INTERNAL_PROXY_SECRET = 'intern'
        process.env.VALKEY_URL = 'redis://example.invalid'
        setHeaders({
            'x-app-proxy-secret': 'intern',
            'x-app-client-ip': '203.0.113.8',
        })
        valkeyMock.get
            .mockResolvedValueOnce('Berlin, Deutschland')
            .mockResolvedValueOnce('__none__')
        const fetchMock = vi.fn<typeof fetch>()
        stubTestGlobal('fetch', fetchMock)

        expect((await getClientRequestMeta()).location).toBe(
            'Berlin, Deutschland',
        )
        expect((await getClientRequestMeta()).location).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(getValkeyConnection).toHaveBeenCalledTimes(2)
        expect(valkeyMock.get.mock.calls[0]?.[0]).toMatch(
            /^rentnerproxy-marketplace:ip-location:[a-f0-9]{64}$/,
        )
        expect(valkeyMock.get.mock.calls[0]?.[0]).not.toContain('203.0.113.8')
    })

    it('ruft den Standortdienst ab und cached Treffer sowie Leerwerte', async function () {
        process.env.INTERNAL_PROXY_SECRET = 'intern'
        process.env.VALKEY_URL = 'redis://example.invalid'
        setHeaders({
            'x-app-proxy-secret': 'intern',
            'x-app-client-ip': '203.0.113.8',
        })
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        cityName: 'Berlin',
                        countryName: 'Deutschland',
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ countryName: 'Deutschland' }), {
                    status: 200,
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({}), { status: 200 }),
            )
        stubTestGlobal('fetch', fetchMock)

        expect((await getClientRequestMeta()).location).toBe(
            'Berlin, Deutschland',
        )
        expect((await getClientRequestMeta()).location).toBe('Deutschland')
        expect((await getClientRequestMeta()).location).toBeNull()
        expect(valkeyMock.set).toHaveBeenNthCalledWith(
            3,
            expect.any(String),
            '__none__',
            'EX',
            86_400,
        )
    })

    it('behandelt HTTP- und Netzwerkfehler ohne Request-Abbruch', async function () {
        process.env.INTERNAL_PROXY_SECRET = 'intern'
        setHeaders({
            'x-app-proxy-secret': 'intern',
            'x-app-client-ip': '203.0.113.8',
        })
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 429 }))
            .mockRejectedValueOnce(new Error('offline'))
        stubTestGlobal('fetch', fetchMock)

        expect((await getClientRequestMeta()).location).toBeNull()
        expect(logWarn).toHaveBeenCalledWith('client_location.lookup_failed', {
            status: 429,
        })
        expect((await getClientRequestMeta()).location).toBeNull()
        expect(logWarn).toHaveBeenCalledWith(
            'client_location.lookup_unavailable',
        )
    })

    it.each([null, [], 42, 'invalid'].map((data) => ({ data })))(
        'ignoriert ungültige Standortantworten: %j',
        async function ({ data }) {
            process.env.INTERNAL_PROXY_SECRET = 'intern'
            setHeaders({
                'x-app-proxy-secret': 'intern',
                'x-app-client-ip': '203.0.113.8',
            })
            stubTestGlobal(
                'fetch',
                vi
                    .fn<typeof fetch>()
                    .mockResolvedValueOnce(
                        new Response(JSON.stringify(data), { status: 200 }),
                    ),
            )
            expect((await getClientRequestMeta()).location).toBeNull()
        },
    )
})
