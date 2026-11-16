import { Link } from '@tanstack/react-router'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import LanguageSwitcher from '@/layouts/PublicLayout/Components/LanguageSwitcher.tsx'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import type { AuthLayoutProps } from '../Types/auth-layout.types.ts'
import AuthBrandPanel from './AuthBrandPanel.tsx'

export default function AuthLayout({ children }: AuthLayoutProps) {
    const { t } = useTranslationStore()

    return (
        <div className="relative isolate grid min-h-svh overflow-x-clip bg-marketplace-canvas text-marketplace-ink [color-scheme:light] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-3 focus:font-semibold focus:text-marketplace-void"
            >
                {t('marketplace.skipToContent')}
            </a>

            <AuthBrandPanel />

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
