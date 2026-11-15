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
                className="relative isolate overflow-hidden bg-marketplace-void text-white"
            >
                <div className="mx-auto max-w-[1440px] px-5 pb-28 pt-16 sm:px-8 sm:pb-36 sm:pt-24 lg:px-12">
                    <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[#a3ffb8]">
                        {t('marketplace.blog.eyebrow')}
                    </p>
                    <h1
                        id="blog-title"
                        className="mt-6 max-w-4xl font-display text-[clamp(2rem,6vw,3.75rem)] leading-[1.02] tracking-tight sm:text-7xl lg:text-8xl"
                    >
                        {t('marketplace.blog.title')}
                    </h1>
                    <svg
                        aria-hidden="true"
                        focusable="false"
                        className="mt-4 h-4 w-48 text-primary sm:w-64"
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
                    <p className="mt-7 max-w-2xl text-lg leading-8 text-[#c1d2c9]">
                        {t('marketplace.blog.description')}
                    </p>
                </div>
                <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 1440 100"
                    preserveAspectRatio="none"
                    className="marketplace-wave pointer-events-none absolute inset-x-0 -bottom-px h-16 w-full sm:h-24"
                >
                    <path
                        d="M0 66C300 4 560 105 900 44S1220 10 1440 58V100H0Z"
                        fill="#0fb33a"
                    />
                    <path
                        d="M0 78C300 16 560 117 900 56S1220 22 1440 70V100H0Z"
                        fill="#30ee61"
                    />
                    <path
                        d="M0 90C300 28 560 129 900 68S1220 34 1440 82V100H0Z"
                        fill="#f7faf8"
                    />
                </svg>
            </section>

            <div className="mx-auto max-w-[1440px] px-5 pb-20 pt-10 sm:px-8 sm:pb-28 sm:pt-14 lg:px-12">
                <section
                    aria-labelledby="featured-post-title"
                    className="relative isolate overflow-hidden rounded-[2rem] border border-white/10 bg-marketplace-void px-7 py-11 text-white sm:px-10 sm:py-14"
                >
                    <CardWave />
                    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)] lg:items-center">
                        <div lang={state.featuredPost?.contentLanguage}>
                            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#a3ffb8]">
                                {state.featuredPost?.releaseTag ??
                                    t('marketplace.blog.featuredLabel')}
                            </p>
                            <h2
                                id="featured-post-title"
                                className="mt-5 max-w-2xl font-display text-4xl leading-[1.04] tracking-tight sm:text-5xl"
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
                            <p className="mt-5 max-w-xl text-sm leading-7 text-[#c1d2c9]">
                                {state.featuredPost?.summary ??
                                    t('marketplace.blog.featuredSummary')}
                            </p>
                            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-[#a3ffb8]">
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
                        <div className="rounded-3xl border border-white/15 bg-white/[0.04] p-6 sm:p-7">
                            <h3 className="font-display text-2xl text-primary">
                                {t('marketplace.blog.centralTitle')}
                            </h3>
                            <p className="mt-3 text-sm leading-7 text-[#c1d2c9]">
                                {t('marketplace.blog.centralDescription')}
                            </p>
                            <ul className="mt-6 space-y-4 border-t border-white/10 pt-6 text-sm text-white">
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
                            className="font-display text-4xl leading-tight tracking-tight sm:text-5xl"
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
                                    className={`rounded-full border px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] ${state.channel === channel ? 'border-marketplace-void bg-marketplace-void text-primary' : 'border-marketplace-void/15 bg-white text-[#52675d] hover:border-[#0d6d2b] hover:text-marketplace-void'}`}
                                >
                                    {t(`marketplace.blog.filters.${channel}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                    {!state.featuredPost && (
                        <p className="mb-7 max-w-3xl text-sm leading-7 text-[#52675d]">
                            {t('marketplace.blog.note')}
                        </p>
                    )}
                    {!state.hasPublishedPosts && (
                        <p
                            role="status"
                            className="mb-7 rounded-xl border border-marketplace-void/10 bg-white px-5 py-4 text-sm text-[#52675d]"
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
                                className="relative isolate overflow-hidden rounded-3xl border border-white/10 bg-marketplace-void text-white px-7 py-10 shadow-[0_16px_40px_rgba(6,18,15,0.12)] sm:px-8 sm:py-11"
                            >
                                <CardWave />
                                <div className="mb-7 flex items-start justify-between gap-4">
                                    <div className="grid h-12 w-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
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
                                    <span className="rounded-full bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a3ffb8]">
                                        {post.kind === 'preview'
                                            ? t(
                                                  'marketplace.blog.versionPending',
                                              )
                                            : post.releaseTag}
                                    </span>
                                </div>
                                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a3ffb8]">
                                    {post.channel === 'rc'
                                        ? 'RC'
                                        : t(
                                              `marketplace.blog.filters.${post.channel}`,
                                          )}
                                </p>
                                <h3
                                    id={post.id}
                                    className="mt-3 font-display text-3xl leading-tight tracking-tight"
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
                                <p className="mt-4 text-sm leading-7 text-[#c1d2c9]">
                                    {post.summary}
                                </p>
                                {post.kind === 'preview' ? (
                                    <p className="mt-7 flex items-center gap-2 border-t border-white/10 pt-5 text-xs font-semibold text-[#c1d2c9]">
                                        {t('marketplace.blog.comingSoon')}
                                        <Clock3
                                            aria-hidden="true"
                                            className="h-4 w-4"
                                        />
                                    </p>
                                ) : (
                                    <p className="mt-7 border-t border-white/10 pt-5 text-xs text-[#c1d2c9]">
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
                    className="mt-12 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#0d6d2b] underline-offset-4 hover:underline"
                >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    {t('marketplace.blog.backHome')}
                </Link>
            </div>
        </div>
    )
}
