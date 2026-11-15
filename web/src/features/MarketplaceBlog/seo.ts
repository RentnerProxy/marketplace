import type { MarketplaceBlogPublishedPost } from './Types/marketplace-blog.types.ts'
import { resolveMarketplaceBlogArticleContent } from './validation.ts'
import { buildMarketplaceHead } from '@/lib/Seo/metadata.ts'

export function buildMarketplaceBlogArticleHead(
    post: MarketplaceBlogPublishedPost,
) {
    const { content } = resolveMarketplaceBlogArticleContent(post, 'de')
    const head = buildMarketplaceHead(
        {
            path: `/blog/${post.id}`,
            title: `${content.title} – RentnerProxy Marketplace`,
            description: content.summary,
        },
        true,
    )
    return {
        ...head,
        meta: [
            ...head.meta,
            { property: 'article:published_time', content: post.publishedAt },
        ],
    }
}
