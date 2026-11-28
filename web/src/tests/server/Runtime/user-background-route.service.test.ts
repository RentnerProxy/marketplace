import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { H3 } from 'nitro/h3'

const fetchSsr = vi.fn(async function (
    _environment: string,
    _request: Request,
): Promise<Response> {
    return new Response(new Uint8Array([82, 73, 70, 70]), {
        headers: {
            'content-type': 'image/webp',
            'cache-control': 'private, no-cache, must-revalidate',
        },
    })
})

vi.mock('nitro/vite/runtime', () => ({ fetchViteEnv: fetchSsr }))

const { default: backgroundRoute } =
    await import('@/server/Runtime/user-background-route.service.ts')
const app = new H3().all('/api/user/background', backgroundRoute)

describe('Nitro background route forwarding', function () {
    beforeEach(function () {
        fetchSsr.mockClear()
    })

    it.each(['GET', 'HEAD'])(
        'forwards a browser %s image request with its session and version',
        async function (method) {
            const request = new Request(
                'https://app.example.test/api/user/background?v=2026-09-07T07%3A34%3A06.671Z',
                {
                    method,
                    headers: {
                        accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
                        cookie: 'session=synthetic-session',
                        'sec-fetch-dest': 'image',
                        'sec-fetch-mode': 'no-cors',
                        'sec-fetch-site': 'same-origin',
                    },
                },
            )

            const response = await app.fetch(request)

            expect(fetchSsr).toHaveBeenCalledTimes(1)
            expect(fetchSsr).toHaveBeenCalledWith('ssr', request)
            expect(response.status).toBe(200)
            expect(response.headers.get('content-type')).toBe('image/webp')
            expect(response.headers.get('cache-control')).toBe(
                'private, no-cache, must-revalidate',
            )
            if (method === 'GET') {
                expect(new Uint8Array(await response.arrayBuffer())).toEqual(
                    new Uint8Array([82, 73, 70, 70]),
                )
            }
        },
    )

    it('forwards conditional headers and preserves a private 304 from the application', async function () {
        const etag = 'W/"synthetic-private-tag"'
        fetchSsr.mockResolvedValueOnce(
            new Response(null, {
                status: 304,
                headers: {
                    etag,
                    vary: 'Cookie',
                    'cache-control': 'private, no-cache, must-revalidate',
                },
            }),
        )
        const request = new Request(
            'https://app.example.test/api/user/background',
            {
                headers: {
                    'if-none-match': etag,
                    cookie: 'session=synthetic-session',
                },
            },
        )
        const response = await app.fetch(request)
        expect(fetchSsr).toHaveBeenCalledWith('ssr', request)
        expect(response.status).toBe(304)
        expect(response.headers.get('etag')).toBe(etag)
        expect(response.headers.get('vary')).toBe('Cookie')
        expect(response.headers.get('cache-control')).toBe(
            'private, no-cache, must-revalidate',
        )
        expect(await response.text()).toBe('')
    })

    it.each([401, 404, 503])(
        'preserves the protected application handler response %s',
        async function (status) {
            fetchSsr.mockResolvedValueOnce(
                new Response('Synthetic protected response', {
                    status,
                    headers: { 'cache-control': 'private, no-store' },
                }),
            )

            const response = await app.fetch(
                new Request('https://app.example.test/api/user/background'),
            )

            expect(response.status).toBe(status)
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            )
            expect(await response.text()).toBe('Synthetic protected response')
        },
    )
})
