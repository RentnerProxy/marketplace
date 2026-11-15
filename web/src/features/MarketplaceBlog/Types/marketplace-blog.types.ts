import type { AppLanguage } from '@/shared/Types/config.types.ts'

export type MarketplaceBlogPostCategory = 'changelog' | 'news'
export type MarketplaceBlogReleaseChannel = 'stable' | 'beta' | 'alpha' | 'rc'
export type MarketplaceBlogPreviewChannel = Exclude<
    MarketplaceBlogReleaseChannel,
    'rc'
>
export type MarketplaceBlogChannelFilter = 'all' | MarketplaceBlogPreviewChannel

export type MarketplaceBlogPreviewPost = {
    kind: 'preview'
    id: string
    category: MarketplaceBlogPostCategory
    channel: MarketplaceBlogPreviewChannel
}

export type MarketplaceBlogArticleContent = {
    title: string
    summary: string
    body: readonly string[]
}

export type MarketplaceBlogPublishedPost = {
    kind: 'published'
    id: string
    category: MarketplaceBlogPostCategory
    releaseTag: string
    version: string
    publishedAt: string
    content: { en: MarketplaceBlogArticleContent } & Partial<
        Record<AppLanguage, MarketplaceBlogArticleContent>
    >
}

export type MarketplaceBlogPost =
    MarketplaceBlogPreviewPost | MarketplaceBlogPublishedPost

export type MarketplaceBlogDisplayPost = {
    id: string
    category: MarketplaceBlogPostCategory
    channel: MarketplaceBlogReleaseChannel
} & (
    | { kind: 'preview'; title: string; summary: string }
    | ({
          kind: 'published'
          releaseTag: string
          version: string
          publishedAt: string
          contentLanguage: AppLanguage
      } & MarketplaceBlogArticleContent)
)

export type MarketplaceBlogLogicReturn = {
    state: {
        channel: MarketplaceBlogChannelFilter
        hasPublishedPosts: boolean
        posts: readonly MarketplaceBlogDisplayPost[]
        featuredPost: Extract<
            MarketplaceBlogDisplayPost,
            { kind: 'published' }
        > | null
    }
    handler: {
        handleChannelChange: (channel: MarketplaceBlogChannelFilter) => void
    }
}

export type MarketplaceBlogArticleProps = {
    post: MarketplaceBlogPublishedPost
}

export type MarketplaceBlogArticleLogicReturn = {
    state: {
        post: MarketplaceBlogPublishedPost
        content: MarketplaceBlogArticleContent
        paragraphs: readonly { key: string; text: string }[]
        contentLanguage: AppLanguage
    }
}

export type MarketplaceBlogResolvedContent = {
    content: MarketplaceBlogArticleContent
    contentLanguage: AppLanguage
}
