import { describe, expect, it, vi } from 'bun:test'
import { isRedirect } from '@tanstack/react-router'
import { marketplaceRobotsDirectives } from '@/config/seo.config.ts'

vi.mock('@/features/MarketplaceBlog/marketplace-blog.config.ts', () => ({
    marketplaceBlogPublishedPosts: [{
        kind: 'published', id: 'synthetic-article', category: 'changelog',
        releaseTag: 'v0.0.0-alpha.0', version: '0.0.0-alpha.0', publishedAt: '2000-01-01',
        content: { en: { title: 'Synthetic release', summary: 'Synthetic summary', body: ['Synthetic details'] } },
    }],
}))

const { getMarketplaceRobotsDirectiveService, addMarketplaceIndexingHeadersService } = await import('@/server/Seo/indexing.service.ts')

describe('Marketplace indexing response policy', () => {
    it.each(['/', '/apps', '/apps/', '/blog', '/imprint', '/privacy', '/blog/synthetic-article'])(
        'allows only an existing successful public page at %s', (pathname) => {
            expect(getMarketplaceRobotsDirectiveService(pathname, 'router')).toBe(marketplaceRobotsDirectives.public)
        },
    )

    it.each(['/login', '/register', '/setup', '/setup/', '/admin/users', '/user/dashboard', '/api/admin/users', '/_serverFn/opaque', '/blog/coming-soon', '/unknown', '//', '/blog/synthetic-article?token=synthetic'])(
        'excludes private, unknown and unpublished pages at %s', (pathname) => {
            expect(getMarketplaceRobotsDirectiveService(pathname, 'router')).toBe(marketplaceRobotsDirectives.private)
        },
    )

    it.each([301, 303, 307, 400, 404, 500, 503])('excludes unsuccessful public responses with status %i', (status) => {
        expect(getMarketplaceRobotsDirectiveService('/apps', 'router', status)).toBe(marketplaceRobotsDirectives.private)
    })

    it('excludes every server function even when its pathname resembles a public page', () => {
        expect(getMarketplaceRobotsDirectiveService('/', 'serverFn')).toBe(marketplaceRobotsDirectives.private)
    })

    it('preserves streaming bodies, cookies and existing privacy headers', async () => {
        const response = new Response('Synthetic stream', { headers: {
            'set-cookie': 'synthetic=1; HttpOnly', 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer',
        } })
        const body = response.body
        expect(addMarketplaceIndexingHeadersService(response, '/setup', 'router')).toBe(response)
        expect(response.body).toBe(body)
        expect(response.headers.get('x-robots-tag')).toBe(marketplaceRobotsDirectives.private)
        expect(response.headers.get('set-cookie')).toBe('synthetic=1; HttpOnly')
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(response.headers.get('referrer-policy')).toBe('no-referrer')
        expect(await response.text()).toBe('Synthetic stream')
    })

    it('preserves TanStack redirect metadata when immutable headers require a wrapper', () => {
        const options = { href: '/login', statusCode: 303 }
        const response = Object.assign(Response.redirect('https://market.rentner.dev/login', 303), { options })
        const decorated = addMarketplaceIndexingHeadersService(response, '/apps', 'router')
        expect(decorated.status).toBe(303)
        expect(decorated.headers.get('location')).toBe('https://market.rentner.dev/login')
        expect(decorated.headers.get('x-robots-tag')).toBe(marketplaceRobotsDirectives.private)
        expect(isRedirect(decorated)).toBe(true)
        expect(Reflect.get(decorated, 'options')).toBe(options)
    })
})
