import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import useFooterLogic from '../Hooks/useFooterLogic.ts'

export default function Footer() {
    const { t } = useTranslationStore()
    const { state } = useFooterLogic()

    return (
        <footer className="relative overflow-hidden bg-marketplace-void text-white">
            <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 1440 120"
                preserveAspectRatio="none"
                className="marketplace-wave pointer-events-none absolute inset-x-0 top-0 h-16 w-full sm:h-24"
            >
                <path
                    d="M0 75C220 19 468 29 720 71S1190 127 1440 55V0H0Z"
                    fill="#0fb33a"
                />
                <path
                    d="M0 64C220 8 468 18 720 60S1190 116 1440 44V0H0Z"
                    fill="#f7faf8"
                />
            </svg>
            <div
                aria-hidden="true"
                className="marketplace-breathe absolute -right-20 top-4 h-72 w-72 rounded-full border-[40px] border-primary/5"
            />
            <div className="relative mx-auto max-w-[1440px] px-5 pb-6 pt-28 sm:px-8 sm:pt-36 lg:px-12">
                <div className="grid gap-12 pb-12 md:grid-cols-[1.4fr_1fr] lg:gap-24">
                    <div>
                        <Link
                            to="/"
                            aria-label={state.companyName}
                            className="inline-flex items-center gap-3"
                        >
                            <MarketplaceLogo
                                className="w-64 sm:w-72"
                                sizes="(min-width: 640px) 288px, 256px"
                            />
                        </Link>
                        <p className="mt-7 max-w-lg font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl">
                            {t('marketplace.footerHeadline')}
                        </p>
                        <p className="mt-4 max-w-sm text-sm leading-7 text-[#91a99d]">
                            {t('marketplace.footerDescription')}
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-8 pt-2">
                        <nav aria-label={t('marketplace.footerExplore')}>
                            <h2 className="text-lg text-white">
                                {t('marketplace.footerExplore')}
                            </h2>
                            <div className="mt-5 flex flex-col items-start gap-4 text-sm text-[#c1d2c9]">
                                <Link
                                    to="/apps"
                                    className="max-w-full [overflow-wrap:anywhere] transition-colors hover:text-primary"
                                >
                                    {t('marketplace.browseApps')}
                                </Link>
                                <Link
                                    to="/blog"
                                    className="max-w-full [overflow-wrap:anywhere] transition-colors hover:text-primary"
                                >
                                    {t('marketplace.navigation.blog')}
                                </Link>
                                <a
                                    href={PROJECT_CONFIG.repositoryUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 transition-colors hover:text-primary"
                                >
                                    GitHub
                                    <ArrowUpRight
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5"
                                    />
                                </a>
                                <Link
                                    to="/login"
                                    className="max-w-full [overflow-wrap:anywhere] transition-colors hover:text-primary"
                                >
                                    {t('marketplace.login')}
                                </Link>
                            </div>
                        </nav>
                        <nav aria-label={t('marketplace.footerLegal')}>
                            <h2 className="text-lg text-white">
                                {t('marketplace.footerLegal')}
                            </h2>
                            <div className="mt-5 flex flex-col items-start gap-4 text-sm text-[#c1d2c9]">
                                <Link
                                    to="/imprint"
                                    className="max-w-full [overflow-wrap:anywhere] transition-colors hover:text-primary"
                                >
                                    {t('layout.footer.imprint')}
                                </Link>
                                <Link
                                    to="/privacy"
                                    className="max-w-full [overflow-wrap:anywhere] transition-colors hover:text-primary"
                                >
                                    {t('layout.footer.privacy')}
                                </Link>
                            </div>
                        </nav>
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-5 border-t border-white/10 pt-6 text-xs text-[#91a99d]">
                    <span>
                        © {state.currentYear} {state.companyName}
                    </span>
                    <span className="font-mono text-[10px]">
                        {state.appVersion}
                    </span>
                </div>
            </div>
        </footer>
    )
}
