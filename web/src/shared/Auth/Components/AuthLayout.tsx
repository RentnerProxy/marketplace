import { Link } from '@tanstack/react-router'
import {
    ArrowLeft,
    Blocks,
    Code2,
    Compass,
    Globe2,
    Layers3,
    Network,
    ShieldCheck,
} from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import LanguageSwitcher from '@/layouts/PublicLayout/Components/LanguageSwitcher.tsx'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import CardWave from '@/shared/Brand/CardWave.tsx'
import type { AuthLayoutProps } from '../Types/auth-layout.types.ts'

export default function AuthLayout({ children }: AuthLayoutProps) {
    const { t } = useTranslationStore()

    return (
        <div className="relative isolate grid min-h-svh overflow-x-clip bg-marketplace-canvas text-marketplace-ink [color-scheme:light] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <CardWave />
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-3 focus:font-semibold focus:text-marketplace-void"
            >
                {t('marketplace.skipToContent')}
            </a>

            <aside className="relative hidden min-h-svh flex-col overflow-hidden bg-[#0b2118] py-8 pl-10 pr-16 text-white lg:flex xl:pl-16 xl:pr-24 2xl:pl-20">
                <Link
                    to="/"
                    aria-label={t('auth.experience.backToMarketplace')}
                    className="relative z-10 w-fit rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                >
                    <MarketplaceLogo className="w-60 xl:w-72" sizes="288px" />
                </Link>

                <div className="relative z-10 my-auto py-8">
                    <p className="mb-5 flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#a0c4ac]">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        {t('auth.experience.eyebrow')}
                    </p>
                    <h2 className="max-w-2xl font-display text-[clamp(2.5rem,3.4vw,4.5rem)] leading-[1.05] tracking-tight">
                        {t('auth.experience.headline')}
                        <span className="mt-1 block text-primary">
                            {t('auth.experience.headlineAccent')}
                        </span>
                    </h2>
                    <p className="mt-5 max-w-md text-base leading-8 text-[#b2c8bc] xl:text-lg">
                        {t('auth.experience.description')}
                    </p>

                    <div
                        aria-hidden="true"
                        className="relative mx-auto mt-8 h-56 w-full max-w-[430px] 2xl:mt-10 2xl:h-64"
                    >
                        <div className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[#335743] 2xl:h-56 2xl:w-56" />
                        <div className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#2a4a38]" />
                        <div className="absolute left-1/2 top-1/2 grid h-36 w-36 -translate-x-1/2 -translate-y-1/2 rotate-[-9deg] grid-cols-2 gap-2 rounded-[1.75rem] border border-[#90e6a3] bg-[#d8f5dc] p-4 text-[#17472a] xl:h-40 xl:w-40">
                            <span className="grid place-items-center rounded-xl bg-white/70">
                                <Globe2 className="h-7 w-7" strokeWidth={1.5} />
                            </span>
                            <span className="grid place-items-center rounded-xl bg-[#b6ebc1]">
                                <Code2 className="h-7 w-7" strokeWidth={1.5} />
                            </span>
                            <span className="grid place-items-center rounded-xl bg-[#b6ebc1]">
                                <ShieldCheck
                                    className="h-7 w-7"
                                    strokeWidth={1.5}
                                />
                            </span>
                            <span className="grid place-items-center rounded-xl bg-white/70">
                                <Blocks className="h-7 w-7" strokeWidth={1.5} />
                            </span>
                        </div>
                        <div className="absolute left-0 top-5 flex rotate-[-5deg] items-center gap-3 rounded-2xl border border-[#395543] bg-[#162f22] px-4 py-3 text-sm font-medium text-[#e0eee4]">
                            <Compass className="h-5 w-5 text-[#9debb0]" />
                            {t('auth.experience.discover')}
                        </div>
                        <div className="absolute right-0 top-11 flex rotate-[6deg] items-center gap-3 rounded-2xl border border-[#395543] bg-[#162f22] px-4 py-3 text-sm font-medium text-[#e0eee4]">
                            <Code2 className="h-5 w-5 text-[#9debb0]" />
                            {t('auth.experience.build')}
                        </div>
                        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 rotate-[-3deg] items-center gap-3 whitespace-nowrap rounded-2xl border border-[#395543] bg-[#162f22] px-4 py-3 text-sm font-medium text-[#e0eee4]">
                            <Network className="h-5 w-5 text-[#9debb0]" />
                            {t('auth.experience.connect')}
                        </div>
                        <span className="absolute bottom-12 left-7 h-2 w-2 rounded-full bg-[#9debb0]" />
                        <span className="absolute bottom-16 right-8 h-3 w-3 rounded-sm border border-[#6eac7f]" />
                    </div>
                </div>

                <p className="relative z-10 flex items-center gap-3 border-t border-white/10 pt-5 text-sm text-[#a0bcaa]">
                    <Layers3 className="h-4 w-4 shrink-0 text-primary" />
                    {t('auth.experience.community')}
                </p>
                <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 90 1000"
                    preserveAspectRatio="none"
                    className="marketplace-wave pointer-events-none absolute inset-y-0 right-0 h-full w-12 xl:w-20"
                >
                    <path
                        d="M22 0C-12 180 70 320 28 510S0 820 32 1000H90V0Z"
                        fill="#0fb33a"
                    />
                    <path
                        d="M35 0C1 180 83 320 41 510S13 820 45 1000H90V0Z"
                        fill="#30ee61"
                    />
                    <path
                        d="M48 0C14 180 96 320 54 510S26 820 58 1000H90V0Z"
                        fill="#f7faf8"
                    />
                </svg>
            </aside>

            <div className="flex min-w-0 flex-col">
                <header className="flex min-h-24 items-center justify-between gap-4 px-5 pb-4 pt-6 sm:px-10 xl:px-14">
                    <Link
                        to="/"
                        aria-label={t('auth.experience.backToMarketplace')}
                        className="group inline-flex items-center gap-2 rounded-lg text-sm font-medium text-[#53675a] transition-colors hover:text-[#17472a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b]"
                    >
                        <MarketplaceLogo
                            className="w-44 sm:w-52 lg:hidden"
                            sizes="208px"
                        />
                        <ArrowLeft
                            aria-hidden="true"
                            className="hidden h-4 w-4 lg:block"
                        />
                        <span className="hidden lg:inline">
                            {t('auth.experience.backToMarketplace')}
                        </span>
                    </Link>
                    <LanguageSwitcher tone="light" />
                </header>

                <main
                    id="main-content"
                    tabIndex={-1}
                    className="flex flex-1 items-center justify-center px-5 pb-8 pt-5 outline-none sm:px-10 sm:pt-8 xl:px-14 2xl:px-20"
                >
                    <div className="w-full max-w-[640px]">{children}</div>
                </main>

                <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-5 pb-6 pt-3 text-xs text-[#65786c] sm:px-10">
                    <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                        />
                        {t('auth.experience.secure')}
                    </span>
                    <Link
                        to="/privacy"
                        className="rounded underline-offset-4 hover:text-[#17472a] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b]"
                    >
                        {t('auth.register.privacy')}
                    </Link>
                    <Link
                        to="/imprint"
                        className="rounded underline-offset-4 hover:text-[#17472a] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b]"
                    >
                        {t('layout.footer.imprint')}
                    </Link>
                </footer>
            </div>
        </div>
    )
}
