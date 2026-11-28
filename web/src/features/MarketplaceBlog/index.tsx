import {
    ArrowLeft,
    Clock3,
    Newspaper,
    Puzzle,
    RefreshCw,
    ScrollText,
    UserRound,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import CardWave from '@/shared/Brand/CardWave.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useMarketplaceBlogLogic from './Hooks/useMarketplaceBlogLogic.ts'
import { marketplaceBlogChannels } from './marketplace-blog.config.ts'

export default function MarketplaceBlog() {
    const { t } = useTranslationStore()
    const { state, handler } = useMarketplaceBlogLogic()

    return (
        <div className="overflow-x-clip bg-marketplace-canvas text-marketplace-ink">
            <section
                aria-labelledby="blog-title"
                className="px-2 pt-4 sm:px-4 sm:pt-6"
            >
                <div className="comic-panel comic-dark relative isolate mx-auto max-w-[1440px] overflow-hidden px-5 pb-14 pt-12 sm:px-8 sm:pb-16 sm:pt-16 lg:px-12">
                    <div
                        aria-hidden="true"
                        className="comic-rays absolute left-[85%] top-1/2 -z-10 aspect-square w-[140%] -translate-x-1/2 -translate-y-1/2 [--rays-a:rgba(48,238,97,0.12)]"
                    />
                    <p className="comic-caption">
                        {t('marketplace.blog.eyebrow')}
                    </p>
                    <h1
                        id="blog-title"
                        className="comic-title mt-6 max-w-4xl text-[clamp(2.6rem,7vw,6rem)] text-white"
                    >
                        {t('marketplace.blog.title')}
                    </h1>
                    <svg
                        aria-hidden="true"
                        focusable="false"
                        className="mt-4 h-4 w-48 text-proxy-400 sm:w-64"
                        viewBox="0 0 256 16"
                        fill="none"
                        preserveAspectRatio="none"
                    >
                        <path
                            d="M4 11C60 4 160 4 252 8"
                            stroke="currentColor"
                            strokeWidth="7"
                            strokeLinecap="round"
                        />
                    </svg>
                    <p className="mt-7 max-w-2xl text-lg leading-8 text-mist-200">
                        {t('marketplace.blog.description')}
                    </p>
                </div>
            </section>

            <div className="mx-auto max-w-[1440px] px-5 pb-20 pt-10 sm:px-8 sm:pb-28 sm:pt-14 lg:px-12">
                <section
                    aria-labelledby="featured-post-title"
                    className="comic-panel comic-dark relative isolate overflow-hidden px-7 py-11 sm:px-10 sm:py-14"
                >
                    <CardWave />
                    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)] lg:items-center">
                        <div lang={state.featuredPost?.contentLanguage}>
                            <p className="comic-chip comic-chip-green text-xs">
                                {state.featuredPost?.releaseTag ??
                                    t('marketplace.blog.featuredLabel')}
                            </p>
                            <h2
                                id="featured-post-title"
                                className="comic-title mt-5 max-w-2xl text-5xl sm:text-6xl"
                            >
                                {state.featuredPost ? (
                                    <Link
                                        to="/blog/$slug"
                                        params={{ slug: state.featuredPost.id }}
                                        className="underline-offset-4 hover:underline"
                                    >
                                        {state.featuredPost.title}
                                    </Link>
                                ) : (
                                    t('marketplace.blog.featuredTitle')
                                )}
                            </h2>
                            <p className="mt-5 max-w-xl text-sm leading-7 text-mist-200">
                                {state.featuredPost?.summary ??
                                    t('marketplace.blog.featuredSummary')}
                            </p>
                            <p className="comic-chip comic-chip-ink mt-6 text-xs">
                                {state.featuredPost ? (
                                    <time
                                        dateTime={
                                            state.featuredPost.publishedAt
                                        }
                                    >
                                        {state.featuredPost.publishedAt}
                                    </time>
                                ) : (
                                    t('marketplace.blog.comingSoon')
                                )}
                            </p>
                        </div>
                        <div className="comic-card comic-on-light bg-white p-6 text-ink sm:p-7">
                            <h3 className="comic-title text-3xl text-ink">
                                {t('marketplace.blog.centralTitle')}
                            </h3>
                            <p className="mt-3 text-sm leading-7 text-steel-600">
                                {t('marketplace.blog.centralDescription')}
                            </p>
                            <ul className="comic-lettering mt-6 space-y-4 border-t-[3px] border-dashed border-ink pt-6 text-sm text-ink">
                                <li className="flex items-center gap-3">
                                    <UserRound
                                        aria-hidden="true"
                                        className="h-5 w-5 shrink-0 text-primary"
                                    />
                                    {t('marketplace.blog.centralAccount')}
                                </li>
                                <li className="flex items-center gap-3">
                                    <RefreshCw
                                        aria-hidden="true"
                                        className="h-5 w-5 shrink-0 text-primary"
                                    />
                                    {t('marketplace.blog.centralUpdates')}
                                </li>
                                <li className="flex items-center gap-3">
                                    <Puzzle
                                        aria-hidden="true"
                                        className="h-5 w-5 shrink-0 text-primary"
                                    />
                                    {t('marketplace.blog.optionalApps')}
                                </li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section
                    aria-labelledby="blog-archive-title"
                    className="mt-16 sm:mt-20"
                >
                    <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
                        <h2
                            id="blog-archive-title"
                            className="comic-title text-5xl sm:text-6xl"
                        >
                            {t('marketplace.blog.archiveTitle')}
                        </h2>
                        <div
                            role="group"
                            aria-label={t('marketplace.blog.filterLabel')}
                            className="flex flex-wrap gap-2"
                        >
                            {marketplaceBlogChannels.map((channel) => (
                                <button
                                    key={channel}
                                    type="button"
                                    aria-pressed={state.channel === channel}
                                    aria-controls="blog-post-list"
                                    onClick={() =>
                                        handler.handleChannelChange(channel)
                                    }
                                    className={`comic-chip min-h-10 px-4 transition-transform hover:-translate-x-px hover:-translate-y-px ${state.channel === channel ? 'comic-chip-ink' : ''}`}
                                >
                                    {t(`marketplace.blog.filters.${channel}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                    {!state.featuredPost && (
                        <p className="mb-7 max-w-3xl text-sm leading-7 text-steel-600">
                            {t('marketplace.blog.note')}
                        </p>
                    )}
                    {!state.hasPublishedPosts && (
                        <p
                            role="status"
                            className="comic-card mb-7 bg-white px-5 py-4 text-sm text-steel-600"
                        >
                            {t('marketplace.blog.emptyChannel')}
                        </p>
                    )}
                    <div
                        id="blog-post-list"
                        aria-live="polite"
                        className="grid gap-5 md:grid-cols-2 lg:grid-cols-3"
                    >
                        {state.posts.map((post) => (
                            <article
                                key={post.id}
                                lang={
                                    post.kind === 'published'
                                        ? post.contentLanguage
                                        : undefined
                                }
                                aria-labelledby={post.id}
                                className="comic-card comic-dark relative isolate overflow-hidden px-7 py-10 sm:px-8 sm:py-11"
                            >
                                <CardWave />
                                <div className="mb-7 flex items-start justify-between gap-4">
                                    <div className="grid h-12 w-12 place-items-center rounded-md border-[3px] border-ink bg-proxy-400 text-ink shadow-[3px_3px_0_0_var(--color-proxy-500)]">
                                        {post.category === 'changelog' ? (
                                            <ScrollText
                                                aria-hidden="true"
                                                className="h-6 w-6"
                                            />
                                        ) : (
                                            <Newspaper
                                                aria-hidden="true"
                                                className="h-6 w-6"
                                            />
                                        )}
                                    </div>
                                    <span className="comic-chip comic-chip-ink text-[11px] uppercase">
                                        {post.kind === 'preview'
                                            ? t(
                                                  'marketplace.blog.versionPending',
                                              )
                                            : post.releaseTag}
                                    </span>
                                </div>
                                <p className="comic-lettering text-xs text-proxy-300">
                                    {post.channel === 'rc'
                                        ? 'RC'
                                        : t(
                                              `marketplace.blog.filters.${post.channel}`,
                                          )}
                                </p>
                                <h3
                                    id={post.id}
                                    className="comic-title mt-3 text-4xl"
                                >
                                    {post.kind === 'published' ? (
                                        <Link
                                            to="/blog/$slug"
                                            params={{ slug: post.id }}
                                            className="underline-offset-4 hover:underline"
                                        >
                                            {post.title}
                                        </Link>
                                    ) : (
                                        post.title
                                    )}
                                </h3>
                                <p className="mt-4 text-sm leading-7 text-mist-200">
                                    {post.summary}
                                </p>
                                {post.kind === 'preview' ? (
                                    <p className="comic-lettering mt-7 flex items-center gap-2 border-t-[3px] border-dashed border-white/25 pt-5 text-xs text-mist-200">
                                        {t('marketplace.blog.comingSoon')}
                                        <Clock3
                                            aria-hidden="true"
                                            className="h-4 w-4"
                                        />
                                    </p>
                                ) : (
                                    <p className="comic-lettering mt-7 border-t-[3px] border-dashed border-white/25 pt-5 text-xs text-mist-200">
                                        <span className="mr-3">
                                            {post.version}
                                        </span>
                                        <time dateTime={post.publishedAt}>
                                            {post.publishedAt}
                                        </time>
                                    </p>
                                )}
                            </article>
                        ))}
                    </div>
                </section>
                <Link
                    to="/"
                    className="comic-btn comic-btn-sm comic-btn-white mt-12"
                >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    {t('marketplace.blog.backHome')}
                </Link>
            </div>
        </div>
    )
}
