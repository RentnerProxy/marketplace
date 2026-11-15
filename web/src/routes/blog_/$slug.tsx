import { buildMarketplaceBlogArticleHead } from '@/features/MarketplaceBlog/seo.ts'
import { createFileRoute, notFound } from '@tanstack/react-router'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'
import MarketplaceBlogArticle from '@/features/MarketplaceBlog/Components/MarketplaceBlogArticle.tsx'
import { marketplaceBlogPublishedPosts } from '@/features/MarketplaceBlog/marketplace-blog.config.ts'
import {
    findMarketplaceBlogPublishedPost,
    parseMarketplaceBlogPublishedPosts,
} from '@/features/MarketplaceBlog/validation.ts'

export const Route = createFileRoute('/blog_/$slug')({
    loader: ({ params }) => {
        const post = findMarketplaceBlogPublishedPost(
            params.slug,
            parseMarketplaceBlogPublishedPosts(marketplaceBlogPublishedPosts),
        )
        if (!post) throw notFound()
        return { post }
    },
    head: ({ loaderData }) => loaderData ? buildMarketplaceBlogArticleHead(loaderData.post) : {},
    component: MarketplaceBlogArticleRoute,
})

function MarketplaceBlogArticleRoute() {
    const { post } = Route.useLoaderData()
    return (
        <PublicLayout>
            <MarketplaceBlogArticle post={post} />
        </PublicLayout>
    )
}
