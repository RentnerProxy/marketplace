import { Link } from '@tanstack/react-router'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import AppLifecycle from './Components/AppLifecycle/index.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

export default function MarketplaceHome() {
    const { t } = useTranslationStore()

    return (
        <div className="bg-marketplace-canvas text-marketplace-ink">
            <section
                aria-labelledby="marketplace-title"
                className="relative isolate overflow-hidden bg-marketplace-void text-white"
            >
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
                >
                    <img
                        src="/brand/marketplace-modules-1536.webp"
                        srcSet="/brand/marketplace-modules-640.webp 640w, /brand/marketplace-modules-1536.webp 1536w"
                        sizes="100vw"
                        alt=""
                        width="1536"
                        height="1024"
                        decoding="async"
                        className="marketplace-art absolute inset-0 hidden h-full w-full object-cover opacity-70 lg:block"
                    />
                    <div className="absolute left-1/2 top-12 h-[550px] w-[950px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(48,238,97,0.13),transparent_68%)]" />
                    <div className="absolute left-1/2 top-24 h-[640px] w-[1100px] -translate-x-1/2 rounded-[50%] border border-white/[0.06] marketplace-orbit" />
                    <div className="absolute left-1/2 top-36 h-[420px] w-[1300px] -translate-x-1/2 rounded-[50%] border border-primary/10 marketplace-orbit-reverse" />
                </div>
                <div className="relative mx-auto flex min-h-[720px] max-w-[1440px] flex-col items-center justify-center px-5 pb-36 pt-14 text-center sm:min-h-[800px] sm:px-8 sm:pb-40 sm:pt-16">
                    <p className="mb-7 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#a3ffb8] sm:text-xs">
                        {t('marketplace.heroEyebrow')}
                    </p>
                    <h1
                        id="marketplace-title"
                        className="font-display text-[clamp(2.75rem,13.5vw,9.5rem)] leading-[0.91] tracking-[-0.035em]"
                    >
                        <span className="block">RentnerProxy</span>{' '}
                        <span className="relative mt-2 block text-primary">
                            Marketplace
                            <span
                                aria-hidden="true"
                                className="marketplace-spin absolute -right-4 -top-1 text-[0.35em] text-white sm:-right-8"
                            >
                                ✳
                            </span>
                        </span>
                    </h1>
                    <p className="mt-8 max-w-2xl text-lg leading-relaxed text-white sm:text-xl">
                        {t('marketplace.tagline')}
                    </p>
                    <p className="mt-3 max-w-xl text-sm leading-7 text-[#a8bdb1] sm:text-base">
                        {t('marketplace.description')}
                    </p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link
                            to="/apps"
                            className="inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-marketplace-void transition-colors hover:bg-primary-hover"
                        >
                            {t('marketplace.browseApps')}
                            <ArrowRight
                                aria-hidden="true"
                                className="h-4 w-4"
                            />
                        </Link>
                        <a
                            href={PROJECT_CONFIG.repositoryUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:border-primary/60 hover:bg-white/5"
                        >
                            {t('marketplace.followDevelopment')}
                            <ArrowUpRight
                                aria-hidden="true"
                                className="h-4 w-4"
                            />
                        </a>
                    </div>
                    <p className="mt-5 max-w-lg text-xs leading-6 text-[#a8bdb1]">
                        {t('marketplace.availability')}
                    </p>
                </div>
                <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 1440 130"
                    preserveAspectRatio="none"
                    className="marketplace-wave pointer-events-none absolute inset-x-0 -bottom-px h-20 w-full sm:h-32"
                >
                    <path
                        d="M0 94C350 18 600 136 940 51S1250 24 1440 72V130H0Z"
                        fill="#0fb33a"
                    />
                    <path
                        d="M0 108C350 33 600 150 940 65S1250 38 1440 86V130H0Z"
                        fill="#30ee61"
                    />
                    <path
                        d="M0 118C350 43 600 160 940 75S1250 48 1440 96V130H0Z"
                        fill="#f7faf8"
                    />
                </svg>
            </section>
            <section
                id="marketplace-flow"
                aria-labelledby="marketplace-flow-title"
                className="mx-auto max-w-[1440px] scroll-mt-36 px-5 lg:scroll-mt-28 pb-24 pt-8 sm:px-8 sm:pb-32 sm:pt-16 lg:px-12"
            >
                <div className="mb-10 max-w-3xl sm:mb-12">
                    <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#0d6d2b]">
                        {t('marketplace.flow.eyebrow')}
                    </p>
                    <h2
                        id="marketplace-flow-title"
                        className="font-display text-4xl leading-[1.03] tracking-tight sm:text-5xl lg:text-6xl"
                    >
                        {t('marketplace.flow.title')}
                    </h2>
                    <p className="mt-5 max-w-2xl text-sm leading-7 text-[#52675d] sm:text-base">
                        {t('marketplace.flow.description')}
                    </p>
                </div>
                <AppLifecycle />
            </section>
        </div>
    )
}
