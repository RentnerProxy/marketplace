import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreBunProperties,
    stubBunProperties,
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { BACKUP_LIMITS } from '@/config/backup.config.ts'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import { parseTrustedProxyRanges } from '@/server/Request/trustedProxy.service.ts'
import {
    isLegacyUserBackgroundPath,
    serveProductionStorageAssetService,
} from '@/server/Production/assets.service.ts'
import {
    MAX_PRODUCTION_REQUEST_BODY_BYTES,
    getRequestProxyMetadataService,
    proxyToInternalAppService,
} from '@/server/Production/proxy.service.ts'
import { addProductionSecurityHeadersService } from '@/server/Production/security-headers.service.ts'
import {
    buildContentSecurityPolicyService,
    withRequestCspContextService,
} from '@/server/Security/csp.service.ts'
import type { ProductionProxyConfig } from '@/server/Production/production.types.ts'

vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', function () {
    return {
        RestoreInProgressError: class extends Error {},
        StorageMutationBarrierUnavailableError: class extends Error {},
        withSharedStorageMutationBarrier: async function <TResult>(
            operation: () => TResult | Promise<TResult>,
        ) {
            return operation()
        },
    }
})

const proxyConfig: ProductionProxyConfig = {
    configuredOrigin: new URL('https://app.example.com'),
    websocketOrigin: 'wss://app.example.com',
    internalPort: 3002,
    internalProxySecret: 'internal-secret',
    trustedProxyRanges: [],
    trustProxyHeaders: false,
}

const assetConfig = {
    defaultPublicRoot: path.resolve('test-default-public'),
    publicStorageRoot: path.resolve('test-public-storage'),
}

describe('Production HTTP-Services', function () {
    afterEach(function () {
        restoreBunProperties()
        restoreTestGlobals()
    })

    it('ergänzt Security-Header und erhält vorhandene Cache-Regeln', async function () {
        const response = addProductionSecurityHeadersService(
            new Response('ok', {
                status: 202,
                headers: { 'cache-control': 'public, max-age=60' },
            }),
            true,
        )

        expect(response.status).toBe(202)
        expect(await response.text()).toBe('ok')
        expect(response.headers.get('cache-control')).toBe('public, max-age=60')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(response.headers.get('strict-transport-security')).toBe(
            'max-age=63072000; includeSubDomains; preload',
        )
    })

    it('setzt für dynamische HTTP-Antworten No-Store ohne HSTS', function () {
        const response = addProductionSecurityHeadersService(
            new Response(null),
            false,
        )

        expect(response.headers.get('cache-control')).toBe(
            'private, no-store, max-age=0',
        )
        expect(response.headers.get('pragma')).toBe('no-cache')
        expect(response.headers.has('strict-transport-security')).toBe(false)
    })

    it('erhält eine explizite No-Referrer-Regel aus der Reset-Anwendung', () => {
        const response = addProductionSecurityHeadersService(
            new Response(null, {
                status: 303,
                headers: {
                    location: '/password-reset#token=synthetic-token',
                    'referrer-policy': 'no-referrer',
                    'cache-control': 'private, no-store, max-age=0',
                },
            }),
            true,
        )
        expect(response.headers.get('referrer-policy')).toBe('no-referrer')
        expect(response.headers.get('cache-control')).toBe(
            'private, no-store, max-age=0',
        )
        expect(response.headers.get('location')).toBe(
            '/password-reset#token=synthetic-token',
        )
        expect(response.body).toBeNull()
    })

    it.each(['unsafe-url', 'origin', 'no-referrer, unsafe-url'])(
        'übernimmt keine schwächere Referrer-Policy %s aus der Anwendung',
        (policy) => {
            const response = addProductionSecurityHeadersService(
                new Response(null, { headers: { 'referrer-policy': policy } }),
                true,
            )
            expect(response.headers.get('referrer-policy')).toBe(
                'strict-origin-when-cross-origin',
            )
        },
    )

    it('erkennt ausschließlich den entfernten Legacy-Hintergrundpfad', function () {
        expect(
            isLegacyUserBackgroundPath('/images/user/user-1/background.webp'),
        ).toBe(true)
        expect(
            isLegacyUserBackgroundPath(
                '/images/user/user-1/background-64.webp',
            ),
        ).toBe(false)
        expect(isLegacyUserBackgroundPath('/images/system/logo.webp')).toBe(
            false,
        )
    })

    it('leitet Nicht-Storage-Pfade nicht an den Asset-Service um', async function () {
        await expect(
            serveProductionStorageAssetService(
                new Request('https://app.example.com/login'),
                assetConfig,
            ),
        ).resolves.toBeNull()
    })

    it('liest Storage-Assets vollständig unter dem Shared-Lock und erhält Range-Header', async function () {
        const events: Array<string> = []
        const bytes = new TextEncoder().encode('asset')
        const arrayBuffer = vi.fn(async function () {
            events.push('bytes-read')
            return bytes.buffer
        })
        stubBunProperties({
            file: vi.fn(function () {
                return {
                    arrayBuffer,
                    exists: vi.fn(async function () {
                        return true
                    }),
                    size: bytes.byteLength,
                }
            }),
        })
        const withStorageBarrier = async function <TResult>(
            operation: () => TResult | Promise<TResult>,
        ) {
            events.push('lock-acquired')
            const result = await operation()
            events.push('lock-released')
            return result
        }

        const response = await serveProductionStorageAssetService(
            new Request(
                'https://app.example.com/images/user/019f5b07-80e2-7000-8000-000000000001/profile.webp?v=1',
                { headers: { range: 'bytes=1-3' } },
            ),
            assetConfig,
            { withStorageBarrier },
        )

        expect(events).toEqual(['lock-acquired', 'bytes-read', 'lock-released'])
        expect(response?.status).toBe(206)
        expect(await response?.text()).toBe('sse')
        expect(response?.headers.get('accept-ranges')).toBe('bytes')
        expect(response?.headers.get('content-range')).toBe('bytes 1-3/5')
        expect(response?.headers.get('content-length')).toBe('3')
        expect(response?.headers.get('content-type')).toBe('image/webp')
        expect(response?.headers.get('cache-control')).toBe(
            'public, max-age=31536000, immutable',
        )
    })

    it('puffert deklarierte übergroße Storage-Assets nicht', async function () {
        const arrayBuffer = vi.fn(async function () {
            return new ArrayBuffer(0)
        })
        stubBunProperties({
            file: vi.fn(function () {
                return {
                    arrayBuffer,
                    exists: vi.fn(async function () {
                        return true
                    }),
                    size: IMAGE_UPLOAD_CONFIG.maxInputBytes + 1,
                }
            }),
        })

        const response = await serveProductionStorageAssetService(
            new Request('https://app.example.com/images/system/logo.webp'),
            assetConfig,
        )

        expect(response?.status).toBe(413)
        expect(arrayBuffer).not.toHaveBeenCalled()
    })

    it('behält für fehlende Storage- und Fallback-Dateien den Null-Vertrag bei', async function () {
        const file = vi.fn(function () {
            return {
                arrayBuffer: vi.fn(),
                exists: vi.fn(async function () {
                    return false
                }),
                size: 0,
            }
        })
        stubBunProperties({ file })

        await expect(
            serveProductionStorageAssetService(
                new Request('https://app.example.com/images/system/logo.webp'),
                assetConfig,
            ),
        ).resolves.toBeNull()
        expect(file).toHaveBeenCalledTimes(2)
    })

    it('verwendet Headeridentitäten ausschließlich mit konfiguriertem Proxyvertrauen', function () {
        const request = new Request('http://app.example.com/path', {
            headers: {
                'x-forwarded-for': '203.0.113.5',
                'x-forwarded-proto': 'https',
            },
        })

        expect(
            getRequestProxyMetadataService(request, '127.0.0.1', proxyConfig),
        ).toEqual({ clientIp: '127.0.0.1', publicProtocol: 'https' })
        expect(
            getRequestProxyMetadataService(request, '127.0.0.1', {
                ...proxyConfig,
                trustProxyHeaders: true,
                trustedProxyRanges: parseTrustedProxyRanges('127.0.0.1/32'),
            }),
        ).toEqual({ clientIp: '203.0.113.5', publicProtocol: 'https' })
    })

    it('ignoriert gefälschte Proxyheader und verwendet die Socket-IP sowie die öffentliche Origin', function () {
        const request = new Request('http://internal.example/path', {
            headers: {
                'x-forwarded-for': '198.51.100.8, 203.0.113.7',
                'x-forwarded-proto': 'http',
                'x-real-ip': '198.51.100.9',
                'cf-connecting-ip': '198.51.100.10',
                'x-app-client-ip': '198.51.100.11',
                'x-app-proxy-secret': 'forged-secret',
            },
        })
        expect(
            getRequestProxyMetadataService(
                request,
                '::ffff:172.18.0.1',
                proxyConfig,
            ),
        ).toEqual({ clientIp: '172.18.0.1', publicProtocol: 'https' })
        for (const directIp of [undefined, '', 'invalid']) {
            expect(
                getRequestProxyMetadataService(request, directIp, proxyConfig),
            ).toBeNull()
        }
    })

    it('lehnt deklarierte übergroße Request-Bodies vor dem Proxy ab', async function () {
        const fetchMock = vi.fn()
        stubTestGlobal('fetch', fetchMock)

        const response = await proxyToInternalAppService(
            new Request('https://app.example.com/api/example', {
                method: 'POST',
                headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
            }),
            { clientIp: '203.0.113.5', publicProtocol: 'https' },
            proxyConfig,
        )

        expect(response.status).toBe(413)
        expect(await response.text()).toBe('Der Request-Body ist zu groß.')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(response.headers.get('strict-transport-security')).toBeTruthy()
    })

    it('verwendet für Backup-Imports dieselbe zentrale Archivgrenze', async function () {
        const fetchMock = vi.fn()
        stubTestGlobal('fetch', fetchMock)

        expect(MAX_PRODUCTION_REQUEST_BODY_BYTES).toBe(
            BACKUP_LIMITS.maxArchiveBytes,
        )
        const response = await proxyToInternalAppService(
            new Request('https://app.example.com/api/admin/backups/import', {
                method: 'POST',
                headers: {
                    'content-length': String(BACKUP_LIMITS.maxArchiveBytes + 1),
                },
            }),
            { clientIp: '203.0.113.5', publicProtocol: 'https' },
            proxyConfig,
        )

        expect(response.status).toBe(413)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('leitet rohe Backup-Uploads unverändert an die interne App weiter', async function () {
        const fetchMock = vi.fn(async function (
            _input: string | URL | Request,
            requestInit?: RequestInit,
        ) {
            const headers = new Headers(requestInit?.headers)

            expect(headers.get('content-type')).toBe('application/x-tar')
            expect(await new Response(requestInit?.body).text()).toBe(
                'raw-backup',
            )
            return Response.json({ success: true })
        })
        stubTestGlobal('fetch', fetchMock)

        const response = await proxyToInternalAppService(
            new Request('https://app.example.com/api/admin/backups/import', {
                method: 'POST',
                headers: { 'content-type': 'application/x-tar' },
                body: new TextEncoder().encode('raw-backup'),
            }),
            { clientIp: '203.0.113.5', publicProtocol: 'https' },
            proxyConfig,
        )

        expect(response.status).toBe(200)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('bereinigt Proxy-Header und verwendet ausschließlich interne Werte', async function () {
        const fetchMock = vi.fn(async function (
            _input: string | URL | Request,
            _init?: RequestInit,
        ) {
            return new Response('proxied', {
                headers: { 'cache-control': 'private, max-age=5' },
            })
        })
        stubTestGlobal('fetch', fetchMock)

        const response = await proxyToInternalAppService(
            new Request('https://public.example.com/path?value=1', {
                headers: {
                    'cf-connecting-ip': '198.51.100.1',
                    forwarded: 'for=198.51.100.2;proto=http;host=evil.example',
                    'x-app-client-ip': '198.51.100.3',
                    'x-app-proxy-secret': 'attacker-secret',
                    'x-forwarded-for': '198.51.100.2',
                    'x-forwarded-host': 'evil.example',
                    'x-forwarded-port': '80',
                    'x-forwarded-proto': 'http',
                    'x-real-ip': '198.51.100.4',
                },
            }),
            {
                clientIp: '203.0.113.5',
                publicProtocol: 'https',
            },
            proxyConfig,
        )

        const [targetUrl, requestInit] = fetchMock.mock.calls[0]!
        const headers = new Headers(requestInit?.headers)

        expect(String(targetUrl)).toBe('http://127.0.0.1:3002/path?value=1')
        expect(headers.get('host')).toBe('app.example.com')
        expect(headers.get('x-app-proxy-secret')).toBe('internal-secret')
        expect(headers.get('x-app-client-ip')).toBe('203.0.113.5')
        for (const name of [
            'cf-connecting-ip',
            'forwarded',
            'x-forwarded-for',
            'x-forwarded-port',
            'x-real-ip',
        ]) {
            expect(headers.get(name)).toBeNull()
        }
        expect(headers.get('x-forwarded-host')).toBe('app.example.com')
        expect(headers.get('x-forwarded-proto')).toBe('https')
        expect(await response.text()).toBe('proxied')
        expect(response.headers.get('cache-control')).toBe('private, max-age=5')
    })

    it.each([true, false])(
        'prüft die innere HTML-CSP gegen den ausdrücklich konfigurierten äußeren WebSocket-Origin',
        async function (matchingOrigin) {
            const websocketOrigin = 'wss://realtime.example.test:8443'
            const policy = withRequestCspContextService(
                websocketOrigin,
                (context) => buildContentSecurityPolicyService(context),
            )
            const cancel = vi.fn()
            const body = new ReadableStream<Uint8Array<ArrayBuffer>>(
                { cancel },
                { highWaterMark: 0 },
            )
            const fetchMock = vi.fn(async function () {
                return new Response(body, {
                    headers: {
                        'content-type': 'text/html; charset=utf-8',
                        'content-security-policy': policy,
                        'referrer-policy': 'no-referrer',
                    },
                })
            })
            stubTestGlobal('fetch', fetchMock)
            const response = await proxyToInternalAppService(
                new Request('https://app.example.com/login'),
                { clientIp: '203.0.113.5', publicProtocol: 'https' },
                {
                    ...proxyConfig,
                    websocketOrigin: matchingOrigin
                        ? websocketOrigin
                        : proxyConfig.websocketOrigin,
                },
            )
            expect(response.status).toBe(matchingOrigin ? 200 : 503)
            expect(response.headers.get('referrer-policy')).toBe('no-referrer')
            expect(response.headers.get('content-security-policy')).toBe(
                matchingOrigin ? policy : buildContentSecurityPolicyService(),
            )
            if (matchingOrigin) {
                expect(response.body).toBe(body)
                expect(cancel).not.toHaveBeenCalled()
                await response.body?.cancel()
            } else {
                expect(cancel).toHaveBeenCalledTimes(1)
            }
        },
    )

    it('begrenzt die asynchrone Backup-Annahme mit der normalen Proxy-Deadline', async function () {
        const fetchMock = vi.fn(async function (
            _input: string | URL | Request,
            _init?: RequestInit,
        ) {
            return Response.json(
                { success: true, backupId: 'synthetic-run' },
                { status: 202 },
            )
        })
        stubTestGlobal('fetch', fetchMock)
        const request = new Request(
            'https://app.example.com/api/admin/backups/download',
            { method: 'POST' },
        )

        await proxyToInternalAppService(
            request,
            { clientIp: '203.0.113.5', publicProtocol: 'https' },
            proxyConfig,
        )

        expect(fetchMock.mock.calls[0]?.[1]?.signal).not.toBe(request.signal)
        expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    })

    it.each([
        ['GET', '/api/admin/backups/01941f29-7c00-7000-8000-000000000001'],
        ['HEAD', '/api/admin/backups/01941f29-7c00-7000-8000-000000000001'],
        ['POST', '/api/admin/backups/import'],
    ])(
        'behält für %s %s das Request-Abbruchsignal ohne Proxy-Deadline',
        async function (method, pathname) {
            const fetchMock = vi.fn(async function (
                _input: string | URL | Request,
                _init?: RequestInit,
            ) {
                return new Response('stream')
            })
            stubTestGlobal('fetch', fetchMock)
            const request = new Request('https://app.example.com' + pathname, {
                method,
            })

            await proxyToInternalAppService(
                request,
                { clientIp: '203.0.113.5', publicProtocol: 'https' },
                proxyConfig,
            )

            expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(request.signal)
        },
    )

    it('begrenzt auch nicht deklarierte Request-Bytes während des Streamings', async function () {
        const fetchMock = vi.fn(async function (
            _input: string | URL | Request,
            init?: RequestInit,
        ) {
            await new Response(init?.body).arrayBuffer()
            return new Response('must not succeed')
        })
        stubTestGlobal('fetch', fetchMock)
        const request = new Request('https://app.example.com/api/example', {
            method: 'POST',
            body: new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array(16 * 1024 * 1024))
                    controller.enqueue(new Uint8Array(1))
                    controller.close()
                },
            }),
        })

        const response = await proxyToInternalAppService(
            request,
            { clientIp: '203.0.113.5', publicProtocol: 'https' },
            proxyConfig,
        )

        expect(response.status).toBe(413)
        expect(await response.text()).toBe('Der Request-Body ist zu groß.')
        expect(response.headers.has('strict-transport-security')).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
