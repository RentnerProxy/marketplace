import { isRedirect } from '@tanstack/react-router'
import { marketplaceRobotsDirectives, marketplaceSeoPages } from '@/config/seo.config.ts'
import { marketplaceBlogPublishedPosts } from '@/features/MarketplaceBlog/marketplace-blog.config.ts'
import { parseMarketplaceBlogPublishedPosts } from '@/features/MarketplaceBlog/validation.ts'

const indexablePaths = new Set<string>([
    ...marketplaceSeoPages.map((page) => page.path),
    ...parseMarketplaceBlogPublishedPosts(marketplaceBlogPublishedPosts).map(
        (post) => `/blog/${post.id}`,
    ),
])

export function getMarketplaceRobotsDirectiveService(
    pathname: string,
    handlerType: string,
    status = 200,
): string {
    const canonicalPath = pathname === '/' ? pathname : pathname.replace(/\/+$/, '')
    return handlerType !== 'serverFn' && status < 300 && indexablePaths.has(canonicalPath)
        ? marketplaceRobotsDirectives.public
        : marketplaceRobotsDirectives.private
}

export function addMarketplaceIndexingHeadersService(
    response: Response,
    pathname: string,
    handlerType: string,
): Response {
    const directive = getMarketplaceRobotsDirectiveService(pathname, handlerType, response.status)
    try {
        response.headers.set('x-robots-tag', directive)
        return response
    } catch {
        const headers = new Headers(response.headers)
        headers.set('x-robots-tag', directive)
        const decorated = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        })
        return isRedirect(response)
            ? Object.assign(decorated, { options: response.options })
            : decorated
    }
}
