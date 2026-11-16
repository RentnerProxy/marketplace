import { describe, expect, it } from 'bun:test'
import { marketplaceSeoPages } from '@/config/seo.config.ts'
import {
    buildMarketplacePageHead,
    marketplaceCanonicalUrl,
} from '@/lib/Seo/metadata.ts'
import { buildMarketplaceSitemap } from '@/lib/Seo/sitemap.ts'
import { buildMarketplaceBlogArticleHead } from '@/features/MarketplaceBlog/seo.ts'
import { parseMarketplaceBlogPublishedPosts } from '@/features/MarketplaceBlog/validation.ts'

const article = {
    kind: 'published',
    id: 'release-v1',
    category: 'changelog',
    releaseTag: 'v1.0.0',
    version: '1.0.0',
    publishedAt: '2026-11-15',
    content: {
        en: {
            title: 'Release </script>',
            summary: 'A real release <announcement>',
            body: ['Published release.'],
        },
    },
}

describe('Marketplace SEO', () => {
    it.each([
        ['/', 'Apps for your stack', 'Explore planned monitoring'],
        ['/apps', 'Apps and extensions', 'Installation will arrive'],
        ['/blog', 'Blog and changelog', 'Follow development'],
        ['/imprint', 'Legal notice', 'operator details'],
        ['/privacy', 'Privacy policy', 'personal data is processed'],
    ])('defaults public metadata to English for %s', (path, title, description) => {
        const head = buildMarketplacePageHead(path)
        expect(head.meta).toContainEqual({
            title: expect.stringContaining(title),
        })
        for (const attribute of [
            { name: 'description' },
            { property: 'og:description' },
            { name: 'twitter:description' },
        ]) {
            expect(head.meta).toContainEqual({
                ...attribute,
                content: expect.stringContaining(description),
            })
        }
    })

    it.each([
        '/apps?token=private#secret',
        'https://attacker.example/apps?token=private#secret',
        '//attacker.example/apps',
    ])('pins canonical and social URLs to the public origin for %s', (path) => {
        const head = buildMarketplacePageHead(path)
        expect(head.links).toEqual([
            { rel: 'canonical', href: 'https://market.rentner.dev/apps' },
        ])
        expect(head.meta).toContainEqual({
            property: 'og:url',
            content: 'https://market.rentner.dev/apps',
        })
        expect(JSON.stringify(head)).not.toContain('attacker')
        expect(JSON.stringify(head)).not.toContain('private')
    })

    it('keeps double-slash path segments on the fixed origin', () => {
        expect(
            new URL(
                marketplaceCanonicalUrl(
                    'https://attacker.example//other.example/path',
                ),
            ).origin,
        ).toBe('https://market.rentner.dev')
    })

    it('gives all five public pages unique metadata and excludes private routes', () => {
        expect(
            new Set(marketplaceSeoPages.map((page) => page.title)).size,
        ).toBe(5)
        expect(
            new Set(marketplaceSeoPages.map((page) => page.description)).size,
        ).toBe(5)
        for (const page of marketplaceSeoPages) {
            expect(buildMarketplacePageHead(page.path).meta).toContainEqual({
                name: 'robots',
                content: 'index, follow, max-image-preview:large',
            })
        }
        expect(() => buildMarketplacePageHead('/register')).toThrow()
    })

    it('publishes only public pages and validated articles with real publication dates', () => {
        const sitemap = buildMarketplaceSitemap([article])
        for (const page of marketplaceSeoPages)
            expect(sitemap).toContain(
                `<loc>https://market.rentner.dev${page.path}</loc>`,
            )
        expect(sitemap).toContain(
            '<loc>https://market.rentner.dev/blog/release-v1</loc><lastmod>2026-11-15</lastmod>',
        )
        expect(sitemap.match(/<lastmod>/g)).toHaveLength(1)
        for (const path of [
            '/register',
            '/login',
            '/setup',
            '/api/',
            'marketplace-alpha-preview',
        ])
            expect(sitemap).not.toContain(path)
        expect(buildMarketplaceSitemap([])).not.toContain('<lastmod>')
        expect(() =>
            buildMarketplaceSitemap([{ ...article, id: '</loc>' }]),
        ).toThrow()
        expect(() =>
            buildMarketplaceSitemap([
                { ...article, publishedAt: '2026-02-30' },
            ]),
        ).toThrow()
        expect(() =>
            buildMarketplaceSitemap([{ kind: 'preview', id: 'preview' }]),
        ).toThrow()
    })

    it('uses published article content as metadata values without executable inline scripts', () => {
        const post = parseMarketplaceBlogPublishedPosts([article])[0]
        if (!post) throw new Error('Missing validated article')
        const head = buildMarketplaceBlogArticleHead(post)
        expect(head.meta).toContainEqual({
            title: 'Release </script> – RentnerProxy Marketplace',
        })
        expect(head.meta).toContainEqual({
            property: 'article:published_time',
            content: '2026-11-15',
        })
        expect(head.links[0]?.href).toBe(
            'https://market.rentner.dev/blog/release-v1',
        )
        expect(head).not.toHaveProperty('scripts')
    })
})
