import type { ReactNode } from 'react'
import { Link, Outlet } from '@tanstack/react-router'
import Footer from './Components/Footer.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function PublicLayout({ children }: { children?: ReactNode }) {
    const { t } = useTranslationStore()

    return (
        <div className="flex min-h-screen flex-col bg-background-dark text-foreground">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
            >
                {t('marketplace.skipToContent')}
            </a>
            <header className="border-b border-white/10 bg-marketplace-void text-white">
                <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-12">
                    <Link
                        to="/"
                        className="flex min-w-0 items-center gap-3"
                        aria-label={t('marketplace.home')}
                    >
                        <img
                            src="/rentnerproxy-logo.png"
                            alt=""
                            className="h-11 w-11 shrink-0 object-contain"
                        />
                        <span className="hidden min-w-0 min-[380px]:block">
                            <span className="block font-display text-lg tracking-tight sm:text-xl">
                                RentnerProxy
                            </span>
                            <span className="block text-xs font-medium uppercase tracking-[0.2em] text-secondary-text">
                                Marketplace
                            </span>
                        </span>
                    </Link>
                    <nav
                        aria-label={t('marketplace.accountNavigation')}
                        className="flex shrink-0 items-center gap-3 sm:gap-5"
                    >
                        <Link
                            to="/login"
                            className="py-2 text-sm font-semibold text-white/80 transition-colors hover:text-primary"
                        >
                            {t('marketplace.login')}
                        </Link>
                        <button
                            type="button"
                            disabled
                            title={t('marketplace.registrationSoon')}
                            aria-label={t('marketplace.registrationSoon')}
                            className="min-h-10 cursor-not-allowed rounded-xl border border-primary/50 bg-primary/10 px-3 py-2 text-xs font-semibold text-[#a3ffb8] sm:px-4 sm:text-sm"
                        >
                            {t('marketplace.register')}
                        </button>
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
