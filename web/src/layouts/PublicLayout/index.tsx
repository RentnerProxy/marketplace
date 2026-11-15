import type { ReactNode } from 'react'
import { Link, Outlet } from '@tanstack/react-router'
import Footer from './Components/Footer.tsx'
import LanguageSwitcher from './Components/LanguageSwitcher.tsx'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function PublicLayout({ children }: { children?: ReactNode }) {
    const { t } = useTranslationStore()

    return (
        <div className="flex min-h-screen flex-col bg-marketplace-canvas text-marketplace-ink">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
            >
                {t('marketplace.skipToContent')}
            </a>
            <header className="border-b border-white/10 bg-marketplace-void text-white">
                <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3 md:flex-nowrap sm:px-8 lg:px-12">
                    <Link
                        to="/"
                        className="flex min-w-0 items-center gap-3"
                        aria-label={t('marketplace.home')}
                    >
                        <MarketplaceLogo className="w-48 sm:w-56" sizes="(min-width: 640px) 224px, 192px" />
                    </Link>
                    <nav
                        aria-label={t('marketplace.accountNavigation')}
                        className="ml-auto flex w-full shrink-0 items-center justify-end gap-3 md:w-auto sm:gap-5"
                    >
                        <Link
                            to="/login"
                            className="py-2 text-sm font-semibold text-white/80 transition-colors hover:text-primary"
                        >
                            {t('marketplace.login')}
                        </Link>
                        <Link to="/register" title={t('marketplace.registrationSoon')} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-marketplace-void transition-colors hover:bg-primary-hover sm:px-4 sm:text-sm">
                            {t('marketplace.register')}
                        </Link>
                        <LanguageSwitcher />
                    </nav>
                </div>
            </header>
            <main
                id="main-content"
                className={
                    children
                        ? 'flex-1'
                        : 'mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-5 py-12 sm:px-8 sm:py-16'
                }
            >
                {children ?? <Outlet />}
            </main>
            <Footer />
        </div>
    )
}
