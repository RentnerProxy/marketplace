import { beforeEach, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { AnchorHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    hookReact,
    renderHook,
    resetHooks,
} from '@/tests/layouts/hook-harness.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'
import {
    marketplaceBlogChannels,
    marketplaceBlogPreviewPosts,
} from '@/features/MarketplaceBlog/marketplace-blog.config.ts'

const previewChannels = [...marketplaceBlogChannels]
const previewPosts = [...marketplaceBlogPreviewPosts]
vi.mock('@/features/MarketplaceBlog/marketplace-blog.config.ts', () => ({
    marketplaceBlogChannels: previewChannels,
    marketplaceBlogPreviewPosts: previewPosts,
    marketplaceBlogPublishedPosts: [],
}))

vi.mock('react', () => hookReact)
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
    Link: ({
        to,
        ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) =>
        createElement('a', { ...props, href: to }),
}))

const { default: useMarketplaceBlogLogic } =
    await import('@/features/MarketplaceBlog/Hooks/useMarketplaceBlogLogic.ts')
const { default: MarketplaceBlog } =
    await import('@/features/MarketplaceBlog/index.tsx')

const renderLogic = () => renderHook(useMarketplaceBlogLogic)
const renderPage = () => renderHook(MarketplaceBlog)

beforeEach(resetHooks)

it('filters planned channel previews and restores all three without pretending releases exist', function () {
    expect(renderLogic().state.posts.map((post) => post.id)).toEqual([
        'marketplace-alpha-preview',
        'marketplace-beta-preview',
        'marketplace-stable-preview',
    ])
    expect(renderLogic().state.hasPublishedPosts).toBe(false)
    for (const channel of ['alpha', 'beta', 'stable'] as const) {
        renderLogic().handler.handleChannelChange(channel)
        expect(renderLogic().state.channel).toBe(channel)
        expect(renderLogic().state.posts.map((post) => post.id)).toEqual([
            `marketplace-${channel}-preview`,
        ])
    }
    renderLogic().handler.handleChannelChange('all')
    expect(renderLogic().state.posts).toHaveLength(3)
})

it('wires accessible filter buttons while keeping article previews free of fake navigation or release dates', function () {
    let tree = renderPage()
    const filter = findElement(
        tree,
        (element) =>
            element.type === 'button' &&
            element.props.children === 'marketplace.blog.filters.beta',
    )
    expect(filter.props['aria-pressed']).toBe(false)
    expect(filter.props['aria-controls']).toBe('blog-post-list')
    invoke(filter, 'onClick')
    tree = renderPage()
    expect(
        findElement(
            tree,
            (element) =>
                element.type === 'button' &&
                element.props.children === 'marketplace.blog.filters.beta',
        ).props['aria-pressed'],
    ).toBe(true)
    const posts = elements(tree).filter((element) => element.type === 'article')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.props['aria-labelledby']).toBe('marketplace-beta-preview')
    expect(
        elements(posts[0]).some(
            (element) =>
                element.type === 'a' ||
                element.type === 'button' ||
                element.type === 'time',
        ),
    ).toBe(false)
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('marketplace.blog.featuredLabel')
    expect(html).toContain('marketplace.blog.centralDescription')
    expect(html).toContain('marketplace.blog.comingSoon')
    expect(html).not.toContain('marketplace.blog.releasePreviews.alpha.title')
})
