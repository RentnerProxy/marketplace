import type { ReactNode } from 'react'
import { Outlet } from '@tanstack/react-router'
import Footer from './Components/Footer.tsx'
import PublicHeader from './Components/PublicHeader.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function PublicLayout({ children }: { children?: ReactNode }) {
    const { t } = useTranslationStore()

    return (
        <div className="flex min-h-screen flex-col bg-marketplace-canvas text-marketplace-ink">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
            >
                {t('marketplace.skipToContent')}
            </a>
            <PublicHeader />
            <main
                id="main-content"
                tabIndex={-1}
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
