import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    HeadContent,
    RouterContextProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    notFound,
} from '@tanstack/react-router'
import { marketplaceRobotsDirectives, marketplaceSeoPages } from '@/config/seo.config.ts'
import { buildMarketplacePageHead } from '@/lib/Seo/metadata.ts'

async function renderHead(path: string) {
    const root = createRootRoute({
        head: () => ({
            meta: [
                { title: 'Private Marketplace default' },
                { name: 'description', content: 'Private default description' },
                { name: 'robots', content: marketplaceRobotsDirectives.private },
            ],
        }),
        notFoundComponent: () => null,
    })
    const publicPage = createRoute({
        getParentRoute: () => root,
        path: '/apps',
        head: () => buildMarketplacePageHead('/apps'),
    })
    const privatePage = createRoute({ getParentRoute: () => root, path: '/login' })
    const missingArticle = createRoute({
        getParentRoute: () => root,
        path: '/missing-article',
        loader: () => { throw notFound() },
        head: () => ({}),
    })
    const router = createRouter({
        routeTree: root.addChildren([publicPage, privatePage, missingArticle]),
        history: createMemoryHistory({ initialEntries: [path] }),
        isServer: true,
    })
    await router.load()
    return renderToStaticMarkup(
        <RouterContextProvider router={router}>
            <html><head><HeadContent /></head><body /></html>
        </RouterContextProvider>,
    )
}

function tags(html: string, name: string) {
    return html.match(new RegExp(`<meta\\b[^>]*name="${name}"[^>]*>`, 'g')) ?? []
}

describe('Real TanStack SSR head inheritance', () => {
    it('replaces root noindex, title and description with one public child value each', async () => {
        const html = await renderHead('/apps?token=private#secret')
        const page = marketplaceSeoPages.find((entry) => entry.path === '/apps')
        if (!page) throw new Error('Missing public page configuration')
        expect(tags(html, 'robots')).toEqual([`<meta name="robots" content="${marketplaceRobotsDirectives.public}"/>`])
        expect(html.match(/<title>[^<]*<\/title>/g)).toEqual([`<title>${page.title}</title>`])
        expect(tags(html, 'description')).toEqual([`<meta name="description" content="${page.description}"/>`])
        expect(html.match(/<link[^>]*rel="canonical"[^>]*>/g)).toEqual(['<link rel="canonical" href="https://market.rentner.dev/apps"/>'])
        expect(html).not.toContain('noindex')
        expect(html).not.toContain('token=')
    })

    it.each(['/login', '/unknown-page', '/missing-article'])(
        'keeps the private default for %s without public metadata',
        async (path) => {
            const html = await renderHead(path)
            expect(tags(html, 'robots')).toEqual([`<meta name="robots" content="${marketplaceRobotsDirectives.private}"/>`])
            expect(html.match(/<title>[^<]*<\/title>/g)).toEqual(['<title>Private Marketplace default</title>'])
            expect(tags(html, 'description')).toEqual(['<meta name="description" content="Private default description"/>'])
            expect(html).not.toContain('rel="canonical"')
        },
    )
})
