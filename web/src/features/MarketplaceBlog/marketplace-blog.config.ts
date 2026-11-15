import publishedPosts from './marketplace-blog.posts.json'
import type {
    MarketplaceBlogChannelFilter,
    MarketplaceBlogPreviewPost,
} from './Types/marketplace-blog.types.ts'

export const marketplaceBlogChannels: readonly MarketplaceBlogChannelFilter[] =
    ['all', 'stable', 'beta', 'alpha']

export const marketplaceBlogPublishedPosts: unknown = publishedPosts

export const marketplaceBlogPreviewPosts: readonly MarketplaceBlogPreviewPost[] =
    [
        {
            kind: 'preview',
            id: 'marketplace-alpha-preview',
            category: 'changelog',
            channel: 'alpha',
        },
        {
            kind: 'preview',
            id: 'marketplace-beta-preview',
            category: 'changelog',
            channel: 'beta',
        },
        {
            kind: 'preview',
            id: 'marketplace-stable-preview',
            category: 'changelog',
            channel: 'stable',
        },
    ]
