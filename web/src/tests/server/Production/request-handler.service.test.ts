import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { mockValkeyDefineCommand } from '@/tests/shared/valkey-script.test.helpers.ts'
import {
    restoreBunProperties,
    restoreTestGlobals,
    stubBunProperties,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { getClientIp } from '@/lib/Request/clientRequestMeta.ts'
import {
    enforceRateLimit,
    RateLimitError,
} from '@/server/RateLimit/rateLimit.service.ts'
import { createProductionRequestHandlerService } from '@/server/Production/request-handler.service.ts'
import { parseTrustedProxyRanges } from '@/server/Request/trustedProxy.service.ts'
import type { ProductionProxyConfig } from '@/server/Production/production.types.ts'
import {
    REALTIME_PUBLISH_PATH,
    REALTIME_WS_PATH,
} from '@/lib/Realtime/realtimeProtocol.ts'
import { setRealtimeServer } from '@/websockets/Server/realtimeServer.ts'
import type {
    BunRealtimeServer,
    BunUpgradeServer,
    RealtimeConnectionData,
} from '@/websockets/Types/bun.ts'
import type {
    HealthBoundaryCase,
    InvalidMetadataCase,
} from './request-handler.service.test.types.ts'

const publicOrigin = 'https://app.example.test:8443'
const internalProxySecret = 'synthetic-internal-proxy-secret'
const publishSecret = 'synthetic-realtime-publish-secret'
const trustedPeer = '10.20.30.40'
const connectionData: RealtimeConnectionData = {
    userId: '01941f29-7c00-7000-8000-000000000001',
    username: 'synthetic-user',
    permissions: [],
    sessionHash: 'a'.repeat(64),
    expiresAt: '2099-01-01T00:00:00.000Z',
    absoluteExpiresAt: '2099-01-01T08:00:00.000Z',
    revocationEpoch: Symbol(),
}
const assetBytes = new TextEncoder().encode('synthetic-asset')
let internalRequestHeaders = new Headers()

const dependencies = {
    fetch: vi.fn(async function (
        _input: string | URL | Request,
        _init?: RequestInit,
    ): Promise<Response> {
        return new Response('internal-app')
    }),
    file: vi.fn(function (_filePath: string) {
        return {
            exists: async function () {
                return true
            },
            arrayBuffer: async function () {
                return assetBytes.buffer
            },
            size: assetBytes.byteLength,
        }
    }),
    storageBarrier: vi.fn(async function <TResult>(
        operation: () => TResult | Promise<TResult>,
    ) {
        return operation()
    }),
    ready: vi.fn(async function () {
        return true
    }),
    restoreActive: vi.fn(async function () {
        return false
    }),
    connection: vi.fn(
        async function (): Promise<RealtimeConnectionData | null> {
            return connectionData
        },
    ),
    dispatch: vi.fn(),
    valkeyEval: vi.fn(async function (
        _script: string,
        _numberOfKeys: number,
        _key: string,
        _window: string,
    ) {
        return [1, 60_000]
    }),
}
const valkey = {
    defineCommand: mockValkeyDefineCommand(dependencies.valkeyEval),
}

vi.mock('@tanstack/react-start/server', function () {
    return {
        getRequestHeader: function (name: string) {
            return internalRequestHeaders.get(name) ?? undefined
        },
    }
})
vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getValkeyConnection: function () {
            return valkey
        },
    }
})
vi.mock('@/server/Logging/logger.ts', function () {
    return { logWarn: vi.fn() }
})
vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', function () {
    return {
        RestoreInProgressError: class extends Error {},
        StorageMutationBarrierUnavailableError: class extends Error {},
        withSharedStorageMutationBarrier: dependencies.storageBarrier,
    }
})
vi.mock('@/server/Admin/Backups/restore-state.service.ts', function () {
    return { isRestoreStateActiveService: dependencies.restoreActive }
})
vi.mock('@/websockets/Server/realtimeSessionValidation.ts', function () {
    return {
        clearRealtimeValidation: vi.fn(),
        getRealtimeConnectionData: dependencies.connection,
        startRealtimeValidation: vi.fn(),
    }
})
vi.mock('@/websockets/Server/realtimeConnectionRegistry.ts', function () {
    return {
        dispatchRealtimeEvent: dependencies.dispatch,
        registerRealtimeConnection: vi.fn(),
        unregisterRealtimeConnection: vi.fn(),
    }
})

const proxyConfig: ProductionProxyConfig = {
    configuredOrigin: new URL(publicOrigin),
    websocketOrigin: 'wss://app.example.test:8443',
    internalPort: 3002,
    internalProxySecret,
    trustedProxyRanges: parseTrustedProxyRanges(
        '10.20.30.40/32,10.20.30.41/32',
    ),
    trustProxyHeaders: true,
}
const assetConfig = {
    defaultPublicRoot: path.resolve('synthetic-production-default'),
    publicStorageRoot: path.resolve('synthetic-production-storage'),
}

function createHandler(
    config: ProductionProxyConfig = proxyConfig,
    assets = assetConfig,
) {
    return createProductionRequestHandlerService({
        proxyConfig: config,
        assetConfig: assets,
        realtimePublishSecret: publishSecret,
        isInternalAppReady: dependencies.ready,
    })
}

function createUpgradeServer(directIp: string | null = trustedPeer) {
    return {
        requestIP: vi.fn(function (_request: Request) {
            return directIp ? { address: directIp } : null
        }),
        timeout: vi.fn(function (_request: Request, _seconds: number) {}),
        upgrade: vi.fn(function (
            _request: Request,
            _options?: { data?: RealtimeConnectionData },
        ) {
            return true
        }),
    } satisfies BunUpgradeServer
}

function createProxiedRequest(
    pathname: string,
    options: RequestInit = {},
    clientIp = '203.0.113.10',
) {
    const headers = new Headers(options.headers)
    headers.set('x-forwarded-for', clientIp + ', 10.20.30.41')
    headers.set('x-forwarded-proto', 'https')
    return new Request('http://private-listener.test:3000' + pathname, {
        ...options,
        headers,
    })
}

function expectNoDownstreamWork(
    server: ReturnType<typeof createUpgradeServer>,
) {
    expect(dependencies.fetch).not.toHaveBeenCalled()
    expect(dependencies.file).not.toHaveBeenCalled()
    expect(dependencies.storageBarrier).not.toHaveBeenCalled()
    expect(dependencies.ready).not.toHaveBeenCalled()
    expect(dependencies.restoreActive).not.toHaveBeenCalled()
    expect(dependencies.connection).not.toHaveBeenCalled()
    expect(dependencies.dispatch).not.toHaveBeenCalled()
    expect(dependencies.valkeyEval).not.toHaveBeenCalled()
    expect(server.timeout).not.toHaveBeenCalled()
    expect(server.upgrade).not.toHaveBeenCalled()
}

const invalidMetadataCases: Array<InvalidMetadataCase> = [
    {
        label: 'fehlende XFF trotz sämtlicher Ersatzheader',
        directIp: trustedPeer,
        headers: {
            'x-forwarded-proto': 'https',
            'cf-connecting-ip': '203.0.113.10',
            'x-real-ip': '203.0.113.10',
            'x-app-client-ip': '203.0.113.10',
            'x-app-proxy-secret': internalProxySecret,
            forwarded: 'for=203.0.113.10;proto=https',
        },
    },
    {
        label: 'beschädigtes mittleres XFF-Glied',
        directIp: trustedPeer,
        headers: {
            'x-forwarded-for': '203.0.113.10, invalid, 10.20.30.41',
            'x-forwarded-proto': 'https',
        },
    },
    {
        label: 'nicht erlaubter direkter Peer',
        directIp: '198.51.100.99',
        headers: {
            'x-forwarded-for': '203.0.113.10',
            'x-forwarded-proto': 'https',
        },
    },
    {
        label: 'fehlende Peer-IP',
        directIp: null,
        headers: {
            'x-forwarded-for': '203.0.113.10',
            'x-forwarded-proto': 'https',
        },
    },
    {
        label: 'fehlendes öffentliches Protokoll',
        directIp: trustedPeer,
        headers: { 'x-forwarded-for': '203.0.113.10' },
    },
    {
        label: 'HTTP-Downgrade der HTTPS-Origin',
        directIp: trustedPeer,
        headers: {
            'x-forwarded-for': '203.0.113.10',
            'x-forwarded-proto': 'http',
        },
    },
    {
        label: 'mehrdeutiges öffentliches Protokoll',
        directIp: trustedPeer,
        headers: {
            'x-forwarded-for': '203.0.113.10',
            'x-forwarded-proto': 'http, https',
        },
    },
]

describe('Produktions-Request-Handler', function () {
    it('prüft den WebSocket-Handler intern auch bei aktivem Proxy-Gate ohne Benutzersitzung', async () => {
        const server = createUpgradeServer('127.0.0.1')
        const response = await createHandler()(
            new Request('http://127.0.0.1:3000/ws', {
                headers: { 'x-realtime-health-secret': internalProxySecret },
            }),
            server,
        )
        expect(response?.status).toBe(426)
        expectNoDownstreamWork(server)
    })

    it.each([
        {
            ip: '203.0.113.9',
            target: 'http://127.0.0.1:3000/ws',
            headers: { 'x-realtime-health-secret': internalProxySecret },
        },
        {
            ip: '127.0.0.1',
            target: 'http://127.0.0.1:3000/ws',
            headers: { 'x-realtime-health-secret': 'wrong-secret' },
        },
        {
            ip: '127.0.0.1',
            target: 'http://127.0.0.1:3000/ws',
            headers: {
                'x-realtime-health-secret': internalProxySecret,
                upgrade: 'websocket',
            },
        },
        {
            ip: '127.0.0.1',
            target: 'http://app.example.test:3000/ws',
            headers: { 'x-realtime-health-secret': internalProxySecret },
        },
        {
            ip: '127.0.0.1',
            target: 'http://127.0.0.1:3000/ws?query',
            headers: { 'x-realtime-health-secret': internalProxySecret },
        },
    ])(
        'öffnet das Proxy-Gate nicht durch einen gefälschten oder veränderten Probe-Aufruf ($target)',
        async ({ ip, target, headers }) => {
            const server = createUpgradeServer(ip)
            const safeHeaders = new Headers()
            for (const [key, value] of Object.entries(headers))
                if (value !== undefined) safeHeaders.set(key, value)
            const response = await createHandler()(
                new Request(target, { headers: safeHeaders }),
                server,
            )
            expect(response?.status).toBe(503)
            expectNoDownstreamWork(server)
        },
    )
    beforeEach(function () {
        vi.clearAllMocks()
        process.env.ORIGIN = publicOrigin
        process.env.INTERNAL_PROXY_SECRET = internalProxySecret
        internalRequestHeaders = new Headers()
        dependencies.ready.mockResolvedValue(true)
        dependencies.restoreActive.mockResolvedValue(false)
        dependencies.connection.mockResolvedValue(connectionData)
        dependencies.fetch.mockImplementation(async function () {
            return new Response('internal-app')
        })
        dependencies.valkeyEval.mockResolvedValue([1, 60_000])
        stubBunProperties({ file: dependencies.file })
        stubTestGlobal('fetch', dependencies.fetch)
    })

    afterEach(function () {
        restoreBunProperties()
        restoreTestGlobals()
        delete process.env.ORIGIN
        delete process.env.INTERNAL_PROXY_SECRET
        delete globalThis.appRealtimeServer
    })

    for (const pathname of [
        '/api/example',
        REALTIME_WS_PATH,
        '/images/system/logo.webp',
        '/images/user/synthetic-user/background.webp',
        '/api/admin/backups/import',
        '/healthz',
    ]) {
        describe(pathname, function () {
            it.each(invalidMetadataCases)(
                'stoppt $label vor sämtlichen nachgelagerten Arbeiten',
                async function (testCase) {
                    const request = new Request(publicOrigin + pathname, {
                        headers: {
                            ...testCase.headers,
                            origin: publicOrigin,
                            upgrade: 'websocket',
                        },
                    })
                    const server = createUpgradeServer(testCase.directIp)
                    const response = await createHandler()(request, server)

                    expect(response?.status).toBe(503)
                    expect(response?.headers.get('cache-control')).toBe(
                        'no-store',
                    )
                    expect(
                        response?.headers.get('strict-transport-security'),
                    ).toBe('max-age=63072000; includeSubDomains; preload')
                    expect(await response?.text()).toBe(
                        'Die Anfrage kann nicht sicher zugeordnet werden.',
                    )
                    expectNoDownstreamWork(server)
                },
            )
        })
    }

    it('erhält zwei echte Client-IP-Identitäten bis zur Rate-Limit-Grenze und entfernt Spoofing-Header', async function () {
        const counts = new Map<string, number>()
        const clientIps: Array<string | null> = []
        dependencies.valkeyEval.mockImplementation(
            async function (_script, _numberOfKeys, key) {
                const count = (counts.get(key) ?? 0) + 1
                counts.set(key, count)
                return [count, 60_000]
            },
        )
        dependencies.fetch.mockImplementation(async function (_input, init) {
            internalRequestHeaders = new Headers(init?.headers)
            clientIps.push(getClientIp())
            await enforceRateLimit({
                scope: 'synthetic-production-client',
                limit: 1,
                windowMs: 60_000,
            })
            return new Response('internal-app', { status: 202 })
        })
        const handler = createHandler()
        const server = createUpgradeServer()
        const spoofingHeaders = {
            host: 'evil.example',
            origin: publicOrigin,
            authorization: 'synthetic-authorization',
            cookie: 'session_id=synthetic-session',
            'cf-connecting-ip': '192.0.2.1',
            'x-real-ip': '192.0.2.2',
            forwarded: 'for=192.0.2.3;host=evil.example;proto=http',
            'x-app-client-ip': '192.0.2.4',
            'x-app-proxy-secret': 'attacker-secret',
            'x-forwarded-host': 'evil.example',
            'x-forwarded-port': '80',
        }
        const firstResponse = await handler(
            createProxiedRequest(
                '/api/example?value=1',
                { headers: spoofingHeaders },
                '203.0.113.10',
            ),
            server,
        )
        const secondResponse = await handler(
            createProxiedRequest(
                '/api/example?value=1',
                { headers: spoofingHeaders },
                '203.0.113.11',
            ),
            server,
        )
        for (const response of [firstResponse, secondResponse]) {
            expect(response?.status).toBe(202)
            expect(response?.headers.has('strict-transport-security')).toBe(
                true,
            )
        }

        expect(clientIps).toEqual(['203.0.113.10', '203.0.113.11'])
        expect(counts.size).toBe(2)
        expect([...counts.values()]).toEqual([1, 1])
        const firstKey = dependencies.valkeyEval.mock.calls[0]?.[2]
        const secondKey = dependencies.valkeyEval.mock.calls[1]?.[2]
        expect(firstKey).not.toBe(secondKey)
        for (const [input, init] of dependencies.fetch.mock.calls) {
            expect(String(input)).toBe(
                'http://127.0.0.1:3002/api/example?value=1',
            )
            const headers = new Headers(init?.headers)
            expect(headers.get('host')).toBe('app.example.test:8443')
            expect(headers.get('x-forwarded-host')).toBe(
                'app.example.test:8443',
            )
            expect(headers.get('x-forwarded-proto')).toBe('https')
            expect(headers.get('x-app-proxy-secret')).toBe(internalProxySecret)
            expect(headers.get('origin')).toBe(publicOrigin)
            expect(headers.get('authorization')).toBe('synthetic-authorization')
            expect(headers.get('cookie')).toBe('session_id=synthetic-session')
            for (const header of [
                'cf-connecting-ip',
                'forwarded',
                'x-forwarded-for',
                'x-forwarded-port',
                'x-real-ip',
            ]) {
                expect(headers.get(header)).toBeNull()
            }
        }

        await expect(
            handler(
                createProxiedRequest('/api/example', {}, '203.0.113.10'),
                server,
            ),
        ).rejects.toBeInstanceOf(RateLimitError)
        expect(dependencies.valkeyEval.mock.calls[2]?.[2]).toBe(firstKey)
        expect(counts.get(secondKey ?? '')).toBe(1)
    })

    it('liest bei einem abgewiesenen Backup-POST weder Body noch Timeout-Vertrag', async function () {
        const request = new Request(
            publicOrigin + '/api/admin/backups/import',
            {
                method: 'POST',
                headers: { 'content-type': 'application/x-tar' },
                body: 'synthetic-untrusted-archive',
            },
        )
        const server = createUpgradeServer()
        const response = await createHandler()(request, server)
        expect(response?.status).toBe(503)
        expect(request.bodyUsed).toBe(false)
        expectNoDownstreamWork(server)
    })

    it('reicht interne Proxyfehler unverändert weiter', async function () {
        const error = new Error('synthetic network failure')
        dependencies.fetch.mockRejectedValueOnce(error)
        await expect(
            createHandler()(
                createProxiedRequest('/api/example'),
                createUpgradeServer(),
            ),
        ).rejects.toBe(error)
    })

    it('liefert gültige Storage-Ranges mit HTTPS-Headern ohne internen Fetch', async function () {
        const directory = await mkdtemp(
            path.join(tmpdir(), 'production-range-test-'),
        )
        try {
            const systemImages = path.join(directory, 'images', 'system')
            await mkdir(systemImages, { recursive: true })
            await writeFile(path.join(systemImages, 'logo.webp'), assetBytes)
            const response = await createHandler(proxyConfig, {
                ...assetConfig,
                publicStorageRoot: directory,
            })(
                createProxiedRequest('/images/system/logo.webp?v=1', {
                    headers: { range: 'bytes=0-2' },
                }),
                createUpgradeServer(),
            )
            expect(response?.status).toBe(206)
            expect(await response?.text()).toBe('syn')
            expect(response?.headers.get('content-range')).toBe('bytes 0-2/15')
            expect(response?.headers.get('cache-control')).toBe(
                'public, max-age=31536000, immutable',
            )
            expect(response?.headers.has('strict-transport-security')).toBe(
                true,
            )
            expect(dependencies.storageBarrier).toHaveBeenCalledTimes(1)
            expect(dependencies.file).not.toHaveBeenCalled()
            expect(dependencies.fetch).not.toHaveBeenCalled()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('erhält den entfernten Hintergrundpfad erst nach gültiger Zuordnung als 404', async function () {
        const server = createUpgradeServer()
        const response = await createHandler()(
            createProxiedRequest('/images/user/synthetic-user/background.webp'),
            server,
        )
        expect(response?.status).toBe(404)
        expect(response?.headers.get('cache-control')).toBe('private, no-store')
        expectNoDownstreamWork(server)
    })

    it('raises the idle timeout for an admitted backup import', async function () {
        const server = createUpgradeServer()
        const request = createProxiedRequest('/api/admin/backups/import', {
            method: 'POST',
            headers: { 'content-type': 'application/x-tar' },
            body: 'synthetic-archive',
        })
        dependencies.fetch.mockImplementation(async function (_input, init) {
            expect(server.timeout).toHaveBeenCalledWith(request, 255)
            expect(init?.signal).toBe(request.signal)
            expect(await new Response(init?.body).text()).toBe(
                'synthetic-archive',
            )
            return new Response('accepted')
        })
        const response = await createHandler()(request, server)
        expect(response?.status).toBe(200)
        expect(server.timeout).toHaveBeenCalledTimes(1)
    })

    it.each(['GET', 'HEAD'])(
        'raises the idle timeout before forwarding a stored backup %s request',
        async function (method) {
            const server = createUpgradeServer()
            const request = createProxiedRequest(
                '/api/admin/backups/01941f29-7c00-7000-8000-000000000001',
                { method },
            )
            dependencies.fetch.mockImplementation(
                async function (_input, init) {
                    expect(server.timeout).toHaveBeenCalledWith(request, 255)
                    expect(init?.signal).toBe(request.signal)
                    return new Response(null)
                },
            )
            expect((await createHandler()(request, server))?.status).toBe(200)
            expect(server.timeout).toHaveBeenCalledTimes(1)
        },
    )

    it('lässt gewöhnliche Requests beim normalen Timeout-Vertrag', async function () {
        const server = createUpgradeServer()
        const request = createProxiedRequest('/api/example')
        await createHandler()(request, server)
        expect(server.timeout).not.toHaveBeenCalled()
        expect(dependencies.fetch.mock.calls[0]?.[1]?.signal).not.toBe(
            request.signal,
        )
    })

    it('gestattet direkten lokalen Betrieb nur mit Loopback-Origin und Loopback-Peer', async function () {
        const localConfig: ProductionProxyConfig = {
            ...proxyConfig,
            configuredOrigin: new URL('http://localhost:3000'),
            trustedProxyRanges: [],
            trustProxyHeaders: false,
        }
        const response = await createHandler(localConfig)(
            new Request('http://localhost:3000/api/example'),
            createUpgradeServer('127.0.0.1'),
        )
        expect(response?.status).toBe(200)
        const headers = new Headers(
            dependencies.fetch.mock.calls[0]?.[1]?.headers,
        )
        expect(headers.get('x-app-client-ip')).toBe('127.0.0.1')
        expect(headers.get('x-forwarded-proto')).toBe('http')
        expect(response?.headers.has('strict-transport-security')).toBe(false)
    })

    it('erhält bei deaktiviertem Proxyvertrauen HTTPS und verwendet ausschließlich die Socket-IP', async function () {
        const server = createUpgradeServer('172.18.0.1')
        const response = await createHandler({
            ...proxyConfig,
            trustProxyHeaders: false,
            trustedProxyRanges: [],
        })(
            new Request('http://internal.example/api/example', {
                headers: {
                    'x-forwarded-for': '198.51.100.8',
                    'x-forwarded-proto': 'http',
                    'x-forwarded-host': 'forged.example',
                    'x-app-client-ip': '198.51.100.9',
                    'x-app-proxy-secret': 'forged-secret',
                },
            }),
            server,
        )
        expect(response?.status).toBe(200)
        const headers = new Headers(
            dependencies.fetch.mock.calls[0]?.[1]?.headers,
        )
        expect(headers.get('host')).toBe(new URL(publicOrigin).host)
        expect(headers.get('x-app-client-ip')).toBe('172.18.0.1')
        expect(headers.get('x-app-proxy-secret')).toBe(
            proxyConfig.internalProxySecret,
        )
        expect(headers.get('x-forwarded-for')).toBeNull()
        expect(headers.get('x-forwarded-proto')).toBe('https')
        expect(response?.headers.has('strict-transport-security')).toBe(true)
    })

    describe('Healthcheck-Ausnahme', function () {
        it.each(['GET', 'HEAD'])(
            'erlaubt den exakten lokalen %s-Check ohne Proxyheader',
            async function (method) {
                const server = createUpgradeServer('127.0.0.1')
                const response = await createHandler()(
                    new Request('http://127.0.0.1:3000/healthz', { method }),
                    server,
                )
                expect(response?.status).toBe(200)
                expect(await response?.text()).toBe(
                    method === 'HEAD' ? '' : 'OK',
                )
                expect(response?.headers.get('cache-control')).toBe('no-store')
                expect(dependencies.ready).toHaveBeenCalledTimes(1)
                expect(dependencies.fetch).not.toHaveBeenCalled()
                expect(server.upgrade).not.toHaveBeenCalled()
                expect(server.timeout).not.toHaveBeenCalled()
            },
        )

        it.each(['GET', 'HEAD'])(
            'meldet fehlende interne Bereitschaft für %s ohne App-Fallback',
            async function (method) {
                dependencies.ready.mockResolvedValue(false)
                const response = await createHandler()(
                    new Request('http://[::1]:3000/healthz', { method }),
                    createUpgradeServer('::1'),
                )
                expect(response?.status).toBe(503)
                expect(await response?.text()).toBe(
                    method === 'HEAD' ? '' : 'NOT READY',
                )
                expect(response?.headers.get('cache-control')).toBe('no-store')
                expect(dependencies.fetch).not.toHaveBeenCalled()
            },
        )

        const boundaryCases: Array<HealthBoundaryCase> = [
            { label: 'Query', url: 'http://127.0.0.1:3000/healthz?check=1' },
            { label: 'Pfadsuffix', url: 'http://127.0.0.1:3000/healthz/' },
            {
                label: 'POST',
                url: 'http://127.0.0.1:3000/healthz',
                method: 'POST',
            },
            { label: 'öffentliche URL', url: publicOrigin + '/healthz' },
            {
                label: 'fremder Peer',
                url: 'http://127.0.0.1:3000/healthz',
                directIp: '198.51.100.20',
            },
            {
                label: 'fehlender Peer',
                url: 'http://127.0.0.1:3000/healthz',
                directIp: null,
            },
        ]
        for (const header of [
            'forwarded',
            'x-forwarded-for',
            'x-forwarded-proto',
            'x-forwarded-host',
            'x-forwarded-port',
            'x-forwarded-custom',
            'cf-connecting-ip',
            'x-real-ip',
            'x-app-client-ip',
            'x-app-proxy-secret',
        ]) {
            boundaryCases.push({
                label: header,
                url: 'http://127.0.0.1:3000/healthz',
                headers: { [header]: '' },
            })
        }
        it.each(boundaryCases)(
            'erweitert die lokale Ausnahme nicht auf $label',
            async function (testCase) {
                const server = createUpgradeServer(
                    testCase.directIp === undefined
                        ? '127.0.0.1'
                        : testCase.directIp,
                )
                const response = await createHandler()(
                    new Request(testCase.url, {
                        method: testCase.method,
                        headers: testCase.headers,
                    }),
                    server,
                )
                expect(response?.status).toBe(503)
                expect(response?.headers.get('cache-control')).toBe('no-store')
                expectNoDownstreamWork(server)
            },
        )

        it('erlaubt normale Health-Requests mit Query über einen gültigen Proxy', async function () {
            const response = await createHandler()(
                createProxiedRequest('/healthz?ready=1'),
                createUpgradeServer(),
            )
            expect(response?.status).toBe(200)
            expect(await response?.text()).toBe('OK')
            expect(dependencies.ready).toHaveBeenCalledTimes(1)
            expect(dependencies.fetch).not.toHaveBeenCalled()
        })
    })

    describe('WebSocket-Vertrag hinter dem gemeinsamen Proxy-Gate', function () {
        it('erhält den echten Origin-/Session-/Upgrade-Ablauf', async function () {
            const request = createProxiedRequest(REALTIME_WS_PATH, {
                headers: { origin: publicOrigin, upgrade: 'websocket' },
            })
            const server = createUpgradeServer()
            const response = await createHandler()(request, server)
            expect(response).toBeUndefined()
            expect(dependencies.restoreActive).toHaveBeenCalledTimes(1)
            expect(dependencies.connection).toHaveBeenCalledWith(request)
            expect(server.upgrade).toHaveBeenCalledWith(request, {
                data: connectionData,
            })
            expect(dependencies.file).not.toHaveBeenCalled()
            expect(dependencies.fetch).not.toHaveBeenCalled()
            expect(server.timeout).not.toHaveBeenCalled()
        })

        it.each([
            ['http://app.example.test:8443', 'websocket', 403],
            ['https://evil.example.test', 'websocket', 403],
            [publicOrigin, 'h2c', 426],
        ])(
            'erhält Origin %s und Upgrade %s als eigene Grenze',
            async function (origin, upgrade, expectedStatus) {
                const server = createUpgradeServer()
                const response = await createHandler()(
                    createProxiedRequest(REALTIME_WS_PATH, {
                        headers: {
                            origin,
                            upgrade,
                        },
                    }),
                    server,
                )
                expect(response?.status).toBe(expectedStatus)
                expectNoDownstreamWork(server)
            },
        )

        it('verlangt nach gültiger Proxy- und Originprüfung weiterhin eine Sitzung', async function () {
            dependencies.connection.mockResolvedValue(null)
            const server = createUpgradeServer()
            const response = await createHandler()(
                createProxiedRequest(REALTIME_WS_PATH, {
                    headers: { origin: publicOrigin, upgrade: 'websocket' },
                }),
                server,
            )
            expect(response?.status).toBe(401)
            expect(dependencies.connection).toHaveBeenCalledTimes(1)
            expect(server.upgrade).not.toHaveBeenCalled()
        })

        it('erhält die Restore-Sperre vor jeder Session-/Upgrade-Arbeit', async function () {
            dependencies.restoreActive.mockResolvedValue(true)
            const server = createUpgradeServer()
            const response = await createHandler()(
                createProxiedRequest(REALTIME_WS_PATH, {
                    headers: { origin: publicOrigin, upgrade: 'websocket' },
                }),
                server,
            )
            expect(response?.status).toBe(503)
            expect(response?.headers.get('retry-after')).toBe('3')
            expect(dependencies.connection).not.toHaveBeenCalled()
            expect(server.upgrade).not.toHaveBeenCalled()
        })
    })

    describe('interne Publish-Bridge', function () {
        const event = {
            type: 'audit-log.created',
            payload: {
                auditLogId: '01941f29-7c00-7000-8000-000000000006',
                createdAt: '2026-09-06T00:00:00.000Z',
            },
        }

        it.each([
            ['GET', publishSecret, 405],
            ['POST', '', 404],
            ['POST', 'wrong-secret', 404],
        ])(
            'hält %s mit Secret %s unabhängig von Proxyheadern gesperrt',
            async function (method, secret, expectedStatus) {
                const server = createUpgradeServer(null)
                const response = await createHandler()(
                    new Request(
                        'http://127.0.0.1:3000' + REALTIME_PUBLISH_PATH,
                        {
                            method,
                            headers: {
                                'x-realtime-publish-secret': secret,
                            },
                        },
                    ),
                    server,
                )
                expect(response?.status).toBe(expectedStatus)
                expect(server.requestIP).not.toHaveBeenCalled()
                expectNoDownstreamWork(server)
            },
        )

        it('prüft den echten Envelope vor der Veröffentlichung', async function () {
            const server = createUpgradeServer(null)
            const response = await createHandler()(
                new Request('http://127.0.0.1:3000' + REALTIME_PUBLISH_PATH, {
                    method: 'POST',
                    headers: { 'x-realtime-publish-secret': publishSecret },
                    body: JSON.stringify({
                        topic: 'admin-audit-logs',
                        event: {},
                    }),
                }),
                server,
            )
            expect(response?.status).toBe(400)
            expectNoDownstreamWork(server)
        })

        it('erlaubt ausschließlich der Secret-Bridge einen gültigen internen Publish ohne Proxy-Metadaten', async function () {
            const realtimeServer = {
                publish: vi.fn(function () {
                    return 1
                }),
                stop: vi.fn(async function () {}),
            } satisfies BunRealtimeServer
            setRealtimeServer(realtimeServer)
            const server = createUpgradeServer(null)
            const response = await createHandler()(
                new Request('http://127.0.0.1:3000' + REALTIME_PUBLISH_PATH, {
                    method: 'POST',
                    headers: { 'x-realtime-publish-secret': publishSecret },
                    body: JSON.stringify({ topic: 'admin-audit-logs', event }),
                }),
                server,
            )
            expect(response?.status).toBe(200)
            expect(await response?.json()).toEqual({ success: true })
            expect(dependencies.dispatch).toHaveBeenCalledWith(
                realtimeServer,
                'admin-audit-logs',
                event,
            )
            expect(server.requestIP).not.toHaveBeenCalled()
            expect(dependencies.fetch).not.toHaveBeenCalled()
            expect(dependencies.file).not.toHaveBeenCalled()
            expect(dependencies.ready).not.toHaveBeenCalled()
        })

        it.each([
            REALTIME_PUBLISH_PATH + '/',
            REALTIME_PUBLISH_PATH + '-other',
        ])(
            'erweitert die Secret-Ausnahme nicht auf %s',
            async function (pathname) {
                const server = createUpgradeServer(null)
                const response = await createHandler()(
                    new Request('http://127.0.0.1:3000' + pathname, {
                        method: 'POST',
                        headers: { 'x-realtime-publish-secret': publishSecret },
                        body: JSON.stringify({
                            topic: 'admin-audit-logs',
                            event,
                        }),
                    }),
                    server,
                )
                expect(response?.status).toBe(503)
                expectNoDownstreamWork(server)
            },
        )
    })
})
