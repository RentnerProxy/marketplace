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
                className="relative isolate mx-auto max-w-4xl overflow-hidden rounded-[2rem] border border-marketplace-void/10 bg-white px-7 py-12 shadow-[0_16px_50px_rgba(5,35,21,0.06)] sm:px-12 sm:py-16"
            >
                <CardWave />
                <header className="border-b border-[#dce6df] pb-8">
                    <p className="flex flex-wrap items-center gap-3 font-mono text-xs text-[#0d6d2b]">
                        <span>{state.post.version}</span>
                        <span aria-hidden="true">/</span>
                        <time dateTime={state.post.publishedAt}>
                            {state.post.publishedAt}
                        </time>
                    </p>
                    <h1
                        id="blog-article-title"
                        className="mt-5 font-display text-4xl leading-tight tracking-tight sm:text-6xl"
                    >
                        {state.content.title}
                    </h1>
                    <p className="mt-6 text-lg leading-8 text-[#52675d]">
                        {state.content.summary}
                    </p>
                </header>
                <div className="space-y-6 pt-8 text-base leading-8 text-[#52675d]">
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
                className="mx-auto mt-8 flex min-h-11 max-w-4xl items-center gap-2 text-sm font-bold text-[#0d6d2b] underline-offset-4 hover:underline"
            >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                {t('marketplace.blog.archiveTitle')}
            </Link>
        </div>
    )
}
