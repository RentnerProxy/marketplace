import { expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    findMarketplaceBlogPublishedPost,
    parseMarketplaceBlogPublishedPosts,
} from '@/features/MarketplaceBlog/validation.ts'
import type { MarketplaceBlogPublishedPost } from '@/features/MarketplaceBlog/Types/marketplace-blog.types.ts'

const syntheticPost: MarketplaceBlogPublishedPost = {
    kind: 'published',
    id: 'synthetic-article',
    category: 'changelog',
    releaseTag: 'v0.0.0-alpha.0',
    version: '0.0.0-alpha.0',
    publishedAt: '2000-01-01',
    content: {
        en: {
            title: 'Synthetic article',
            summary: 'Synthetic summary',
            body: ['<script>alert("synthetic")</script>'],
        },
    },
}
let options: {
    loader: (args: { params: { slug: string } }) => {
        post: MarketplaceBlogPublishedPost
    }
    component: () => ReactNode
}
let slug = 'synthetic-article'
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language: 'fr', t: (key: string) => key }),
}))
vi.mock('@/features/MarketplaceBlog/marketplace-blog.config.ts', () => ({
    marketplaceBlogPublishedPosts: [syntheticPost],
}))
vi.mock('@/layouts/PublicLayout/index.tsx', () => ({
    default: ({ children }: { children: ReactNode }) =>
        createElement('main', null, 'Public shell', children),
}))
vi.mock('@tanstack/react-router', () => ({
    Link: ({
        to,
        ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) =>
        createElement('a', { ...props, href: to }),
    notFound: () => new Error('Article not found'),
    createFileRoute: () => (next: typeof options) => {
        options = next
        return { useLoaderData: () => options.loader({ params: { slug } }) }
    },
}))

await import('@/routes/blog_/$slug.tsx')

it('resolves only validated published slugs and gives unknown or preview slugs the route not-found outcome', function () {
    const posts = parseMarketplaceBlogPublishedPosts([syntheticPost])
    expect(
        findMarketplaceBlogPublishedPost('synthetic-article', posts)?.id,
    ).toBe('synthetic-article')
    expect(
        findMarketplaceBlogPublishedPost('../synthetic-article', posts),
    ).toBeNull()
    expect(
        findMarketplaceBlogPublishedPost('marketplace-news-preview', posts),
    ).toBeNull()
    expect(() => options.loader({ params: { slug: 'unknown-post' } })).toThrow(
        'Article not found',
    )
    expect(() =>
        options.loader({ params: { slug: 'marketplace-news-preview' } }),
    ).toThrow('Article not found')
})

it('renders a published body safely in the public shell with the actual English fallback language', function () {
    slug = 'synthetic-article'
    const html = renderToStaticMarkup(createElement(options.component))
    expect(html).toContain('Public shell')
    expect(html).toContain('<article lang="en"')
    expect(html).toContain('Synthetic article')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('href="/blog"')
})

it.each([
    { ...syntheticPost, kind: 'preview' },
    { ...syntheticPost, releaseTag: 'v-mismatch' },
    { ...syntheticPost, publishedAt: '2000-02-31' },
    {
        ...syntheticPost,
        content: {
            en: {
                title: 'Synthetic',
                summary: 'Summary',
                body: ['<!-- marketplace:reserved -->'],
            },
        },
    },
])(
    'rejects invalid published source data before article lookup',
    function (invalid) {
        expect(() => parseMarketplaceBlogPublishedPosts([invalid])).toThrow()
    },
)
