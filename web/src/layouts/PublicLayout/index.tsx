import type { ReactNode } from 'react'
import { Link, Outlet } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
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
            <header className="border-b border-border-dark">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
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
                        <span className="min-w-0">
                            <span className="block text-base font-bold tracking-tight sm:text-lg">
                                RentnerProxy
                            </span>
                            <span className="block text-xs font-medium uppercase tracking-[0.2em] text-secondary-text">
                                Marketplace
                            </span>
                        </span>
                    </Link>
                    <Link
                        to="/login"
                        className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border-dark bg-surface-dark px-3 py-2.5 text-sm font-semibold transition-colors hover:border-primary hover:text-primary sm:px-4"
                    >
                        {t('marketplace.adminLogin')}
                        <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
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
