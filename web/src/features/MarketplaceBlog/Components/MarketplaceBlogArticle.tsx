import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import CardWave from '@/shared/Brand/CardWave.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useMarketplaceBlogArticleLogic from '../Hooks/useMarketplaceBlogArticleLogic.ts'
import type { MarketplaceBlogArticleProps } from '../Types/marketplace-blog.types.ts'

export default function MarketplaceBlogArticle({
    post,
}: MarketplaceBlogArticleProps) {
    const { t } = useTranslationStore()
    const { state } = useMarketplaceBlogArticleLogic(post)

    return (
        <div className="bg-marketplace-canvas px-5 py-12 text-marketplace-ink sm:px-8 sm:py-20">
            <article
                lang={state.contentLanguage}
                aria-labelledby="blog-article-title"
                className="comic-panel relative isolate mx-auto max-w-4xl overflow-hidden bg-white px-7 py-12 sm:px-12 sm:py-16"
            >
                <CardWave />
                <header className="border-b-[3px] border-dashed border-ink pb-8">
                    <p className="comic-lettering flex flex-wrap items-center gap-3 text-xs text-proxy-800">
                        <span>{state.post.version}</span>
                        <span aria-hidden="true">/</span>
                        <time dateTime={state.post.publishedAt}>
                            {state.post.publishedAt}
                        </time>
                    </p>
                    <h1
                        id="blog-article-title"
                        className="comic-title mt-5 text-5xl sm:text-7xl"
                    >
                        {state.content.title}
                    </h1>
                    <p className="mt-6 text-lg leading-8 text-steel-600">
                        {state.content.summary}
                    </p>
                </header>
                <div className="space-y-6 pt-8 text-base leading-8 text-steel-700">
                    {state.paragraphs.map((paragraph) => (
                        <p
                            key={paragraph.key}
                            className="whitespace-pre-wrap break-words"
                        >
                            {paragraph.text}
                        </p>
                    ))}
                </div>
            </article>
            <Link
                to="/blog"
                className="comic-btn comic-btn-sm comic-btn-white mx-auto mt-8 flex w-fit max-w-4xl"
            >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                {t('marketplace.blog.archiveTitle')}
            </Link>
        </div>
    )
}
