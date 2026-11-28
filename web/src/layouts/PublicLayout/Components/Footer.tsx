import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import useFooterLogic from '../Hooks/useFooterLogic.ts'

const footerLinkClassName =
    'comic-focus max-w-full rounded-sm [overflow-wrap:anywhere] transition-colors hover:text-proxy-300 hover:underline hover:decoration-wavy hover:decoration-2 hover:underline-offset-4'

export default function Footer() {
    const { t } = useTranslationStore()
    const { state } = useFooterLogic()

    return (
        <footer className="bg-marketplace-canvas px-2 pb-2 pt-10 sm:px-4 sm:pb-4">
            <div className="comic-panel comic-dark relative isolate mx-auto max-w-[1440px] overflow-hidden px-5 pb-5 pt-10 text-mist-200 sm:px-8 sm:pt-12 lg:px-12">
                <div
                    aria-hidden="true"
                    className="comic-speedlines pointer-events-none absolute inset-0 -z-10"
                />
                <div className="grid gap-12 pb-10 md:grid-cols-[1.4fr_1fr] lg:gap-24">
                    <div>
                        <Link
                            to="/"
                            aria-label={state.companyName}
                            className="comic-focus inline-flex rounded-md"
                        >
                            <MarketplaceLogo size="lg" />
                        </Link>
                        <p className="comic-title mt-7 max-w-lg text-4xl text-white sm:text-5xl">
                            {t('marketplace.footerHeadline')}
                        </p>
                        <p className="mt-4 max-w-sm text-sm leading-7 text-mist-300">
                            {t('marketplace.footerDescription')}
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-8 pt-2">
                        <nav aria-label={t('marketplace.footerExplore')}>
                            <h2 className="comic-caption">
                                {t('marketplace.footerExplore')}
                            </h2>
                            <div className="comic-lettering mt-5 flex flex-col items-start gap-4 text-sm text-white">
                                <Link
                                    to="/apps"
                                    className={footerLinkClassName}
                                >
                                    {t('marketplace.browseApps')}
                                </Link>
                                <Link
                                    to="/blog"
                                    className={footerLinkClassName}
                                >
                                    {t('marketplace.navigation.blog')}
                                </Link>
                                <a
                                    href={PROJECT_CONFIG.repositoryUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-flex items-center gap-2 ${footerLinkClassName}`}
                                >
                                    GitHub
                                    <ArrowUpRight
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5"
                                    />
                                </a>
                                <Link
                                    to="/login"
                                    className={footerLinkClassName}
                                >
                                    {t('marketplace.login')}
                                </Link>
                            </div>
                        </nav>
                        <nav aria-label={t('marketplace.footerLegal')}>
                            <h2 className="comic-caption comic-caption-white">
                                {t('marketplace.footerLegal')}
                            </h2>
                            <div className="comic-lettering mt-5 flex flex-col items-start gap-4 text-sm text-white">
                                <Link
                                    to="/imprint"
                                    className={footerLinkClassName}
                                >
                                    {t('layout.footer.imprint')}
                                </Link>
                                <Link
                                    to="/privacy"
                                    className={footerLinkClassName}
                                >
                                    {t('layout.footer.privacy')}
                                </Link>
                            </div>
                        </nav>
                    </div>
                </div>
                <div className="comic-lettering flex flex-wrap items-center justify-between gap-5 border-t-[3px] border-dashed border-white/35 pt-5 text-xs text-mist-300">
                    <span>
                        © {state.currentYear} {state.companyName}
                    </span>
                    <span className="font-mono text-[10px] normal-case">
                        {state.appVersion}
                    </span>
                </div>
            </div>
        </footer>
    )
}
