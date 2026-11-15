import { beforeEach, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { AnchorHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    hookReact,
    renderHook,
    resetHooks,
} from '@/tests/layouts/hook-harness.ts'
import type { MarketplaceBlogPublishedPost } from '@/features/MarketplaceBlog/Types/marketplace-blog.types.ts'
import { resolveMarketplaceBlogReleaseChannel } from '@/features/MarketplaceBlog/validation.ts'

let language = 'de'
function fixture(
    version: string,
    category: 'changelog' | 'news' = 'changelog',
    publishedAt = '2000-01-01',
): MarketplaceBlogPublishedPost {
    return {
        kind: 'published',
        id: `synthetic-${version.replaceAll('.', '-')}`,
        category,
        releaseTag: `v${version}`,
        version,
        publishedAt,
        content: {
            en: {
                title: 'Synthetic English release',
                summary: 'Synthetic summary',
                body: ['Synthetic release details'],
            },
            de: {
                title: 'Synthetische deutsche Version',
                summary: 'Synthetische Zusammenfassung',
                body: ['Synthetische Versionsdetails'],
            },
        },
    }
}
const publishedPosts: readonly MarketplaceBlogPublishedPost[] = [
    fixture('0.0.0-alpha.0'),
    fixture('0.0.0-beta.0', 'news', '2000-01-02'),
    fixture('0.0.0'),
    fixture('0.0.0-rc.0'),
]

vi.mock('react', () => hookReact)
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language, t: (key: string) => key }),
}))
vi.mock('@/features/MarketplaceBlog/marketplace-blog.config.ts', () => ({
    marketplaceBlogChannels: ['all', 'stable', 'beta', 'alpha'],
    marketplaceBlogPublishedPosts: publishedPosts,
    marketplaceBlogPreviewPosts: [
        {
            kind: 'preview',
            id: 'alpha-preview',
            category: 'changelog',
            channel: 'alpha',
        },
        {
            kind: 'preview',
            id: 'beta-preview',
            category: 'changelog',
            channel: 'beta',
        },
        {
            kind: 'preview',
            id: 'stable-preview',
            category: 'changelog',
            channel: 'stable',
        },
    ],
}))
vi.mock('@tanstack/react-router', () => ({
    Link: ({
        to,
        params,
        ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & {
        to: string
        params?: { slug: string }
    }) =>
        createElement('a', {
            ...props,
            href: to.replace('$slug', params?.slug ?? ''),
        }),
}))
const { default: MarketplaceBlog } =
    await import('@/features/MarketplaceBlog/index.tsx')
const { default: useMarketplaceBlogLogic } =
    await import('@/features/MarketplaceBlog/Hooks/useMarketplaceBlogLogic.ts')
const render = () => renderHook(useMarketplaceBlogLogic)

beforeEach(resetHooks)

it.each(['de', 'fr'])(
    'reads bundled published content in %s with English fallback and release metadata',
    function (locale) {
        language = locale
        const post = render().state.posts[0]
        expect(post).toMatchObject({
            kind: 'published',
            releaseTag: 'v0.0.0-beta.0',
            version: '0.0.0-beta.0',
            channel: 'beta',
            publishedAt: '2000-01-02',
            ...(locale === 'de'
                ? publishedPosts[1]?.content.de
                : publishedPosts[1]?.content.en),
        })
    },
)

it('derives channels from validated tags, independent of post category, and keeps RC only in All', function () {
    expect(render().state.posts).toHaveLength(4)
    for (const [channel, tag] of [
        ['stable', 'v0.0.0'],
        ['beta', 'v0.0.0-beta.0'],
        ['alpha', 'v0.0.0-alpha.0'],
    ] as const) {
        render().handler.handleChannelChange(channel)
        expect(
            render().state.posts.map((post) =>
                post.kind === 'published' ? post.releaseTag : '',
            ),
        ).toEqual([tag])
        expect(render().state.hasPublishedPosts).toBe(true)
    }
    render().handler.handleChannelChange('all')
    expect(render().state.posts.some((post) => post.channel === 'rc')).toBe(
        true,
    )
})

it.each([
    'v1.0.0-preview.1',
    'v1.0.0-beta.01',
    'v01.0.0',
    '1.0.0',
    'v1.0.0-rc',
    'v1.0.0+metadata',
])(
    'rejects unsupported tag identity %s instead of treating it as Stable',
    function (tag) {
        expect(() => resolveMarketplaceBlogReleaseChannel(tag)).toThrow()
    },
)

it('features the newest real article and replaces initial previews and no-articles copy after publication', function () {
    language = 'en'
    expect(render().state.featuredPost).toMatchObject({
        releaseTag: 'v0.0.0-beta.0',
        publishedAt: '2000-01-02',
    })
    expect(
        render().state.posts.every((post) => post.kind === 'published'),
    ).toBe(true)
    const html = renderToStaticMarkup(renderHook(MarketplaceBlog))
    expect(html).toContain('href="/blog/synthetic-0-0-0-beta-0"')
    expect(html).toContain('2000-01-02')
    for (const key of [
        'featuredLabel',
        'featuredTitle',
        'note',
        'comingSoon',
        'versionPending',
    ]) {
        expect(html).not.toContain(`marketplace.blog.${key}`)
    }
    render().handler.handleChannelChange('alpha')
    expect(render().state.featuredPost?.releaseTag).toBe('v0.0.0-beta.0')
    expect(render().state.posts.map((post) => post.channel)).toEqual(['alpha'])
})
