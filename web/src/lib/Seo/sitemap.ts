import { marketplaceSeoPages } from '@/config/seo.config.ts'
import { marketplaceBlogPublishedPosts } from '@/features/MarketplaceBlog/marketplace-blog.config.ts'
import { parseMarketplaceBlogPublishedPosts } from '@/features/MarketplaceBlog/validation.ts'
import { marketplaceCanonicalUrl } from './metadata.ts'

export function buildMarketplaceSitemap(input: unknown = marketplaceBlogPublishedPosts): string {
    const posts = parseMarketplaceBlogPublishedPosts(input)
    const pages = marketplaceSeoPages.map((page) => `<url><loc>${marketplaceCanonicalUrl(page.path)}</loc></url>`)
    const articles = posts.map((post) => `<url><loc>${marketplaceCanonicalUrl(`/blog/${post.id}`)}</loc><lastmod>${post.publishedAt}</lastmod></url>`)
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...pages, ...articles].join('')}</urlset>`
}
