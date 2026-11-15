import { useMemo, useState } from 'react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    parseMarketplaceBlogPublishedPosts,
    resolveMarketplaceBlogArticleContent,
    resolveMarketplaceBlogReleaseChannel,
} from '../validation.ts'
import {
    marketplaceBlogPreviewPosts,
    marketplaceBlogPublishedPosts,
} from '../marketplace-blog.config.ts'
import type {
    MarketplaceBlogChannelFilter,
    MarketplaceBlogDisplayPost,
    MarketplaceBlogLogicReturn,
} from '../Types/marketplace-blog.types.ts'

export default function useMarketplaceBlogLogic(): MarketplaceBlogLogicReturn {
    const [channel, setChannel] = useState<MarketplaceBlogChannelFilter>('all')
    const { language, t } = useTranslationStore()
    const publishedPosts = useMemo(
        () => parseMarketplaceBlogPublishedPosts(marketplaceBlogPublishedPosts),
        [],
    )
    const posts: MarketplaceBlogDisplayPost[] = [
        ...publishedPosts,
        ...marketplaceBlogPreviewPosts,
    ].map((post) => {
        if (post.kind === 'preview') {
            return {
                kind: post.kind,
                id: post.id,
                category: post.category,
                channel: post.channel,
                title: t(
                    `marketplace.blog.releasePreviews.${post.channel}.title`,
                ),
                summary: t(
                    `marketplace.blog.releasePreviews.${post.channel}.summary`,
                ),
            }
        }
        const { content, contentLanguage } =
            resolveMarketplaceBlogArticleContent(post, language)
        return {
            kind: post.kind,
            id: post.id,
            category: post.category,
            channel: resolveMarketplaceBlogReleaseChannel(post.releaseTag),
            releaseTag: post.releaseTag,
            version: post.version,
            publishedAt: post.publishedAt,
            contentLanguage,
            title: content.title,
            summary: content.summary,
            body: content.body,
        }
    })
    const filteredPosts = posts.filter(
        (post) => channel === 'all' || post.channel === channel,
    )

    return {
        state: {
            channel,
            posts: filteredPosts,
            hasPublishedPosts: filteredPosts.some(
                (post) => post.kind === 'published',
            ),
        },
        handler: { handleChannelChange: setChannel },
    }
}
