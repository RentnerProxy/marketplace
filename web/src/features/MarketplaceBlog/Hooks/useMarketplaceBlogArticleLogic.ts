import useTranslationStore from '@/language/useTranslationStore.ts'
import { resolveMarketplaceBlogArticleContent } from '../validation.ts'
import type {
    MarketplaceBlogArticleLogicReturn,
    MarketplaceBlogPublishedPost,
} from '../Types/marketplace-blog.types.ts'

export default function useMarketplaceBlogArticleLogic(
    post: MarketplaceBlogPublishedPost,
): MarketplaceBlogArticleLogicReturn {
    const { language } = useTranslationStore()
    const { content, contentLanguage } = resolveMarketplaceBlogArticleContent(
        post,
        language,
    )
    const occurrences = new Map<string, number>()
    const paragraphs = content.body.map((text) => {
        const occurrence = occurrences.get(text) ?? 0
        occurrences.set(text, occurrence + 1)
        return { key: `${post.id}:${occurrence}:${text}`, text }
    })
    return { state: { post, content, paragraphs, contentLanguage } }
}
