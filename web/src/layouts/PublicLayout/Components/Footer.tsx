import { Link } from '@tanstack/react-router'
import { ArrowUpRight, ArrowUp } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import useFooterLogic from '../Hooks/useFooterLogic.ts'

export default function Footer() {
    const { t } = useTranslationStore()
    const { state, handler } = useFooterLogic()

    return (
        <footer className="relative overflow-hidden bg-marketplace-void text-white">
            <div
                aria-hidden="true"
                className="marketplace-breathe absolute -right-20 top-4 h-72 w-72 rounded-full border-[40px] border-primary/5"
            />
            <div className="relative mx-auto max-w-[1440px] px-5 pb-6 pt-12 sm:px-8 sm:pt-16 lg:px-12">
                <div className="grid gap-12 pb-12 md:grid-cols-[1.4fr_1fr] lg:gap-24">
                    <div>
                        <Link
                            to="/"
                            aria-label={state.companyName}
                            className="inline-flex items-center gap-3"
                        >
                            <img
                                src="/rentnerproxy-logo.png"
                                alt=""
                                width="48"
                                height="48"
                                className="h-12 w-12 object-contain"
                            />
                            <span className="font-display text-2xl">
                                RentnerProxy
                                <span className="block text-primary sm:ml-2 sm:inline">
                                    Marketplace
                                </span>
                            </span>
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
                                    to="/"
                                    hash="marketplace-outlook"
                                    className="max-w-full [overflow-wrap:anywhere] transition-colors hover:text-primary"
                                >
                                    {t('marketplace.browseApps')}
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
                                    to="/terms"
                                    className="max-w-full [overflow-wrap:anywhere] transition-colors hover:text-primary"
                                >
                                    {t('layout.footer.terms')}
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
                    <div className="flex items-center gap-5">
                        <div
                            className="inline-flex gap-1"
                            role="group"
                            aria-label={t('marketplace.footerLanguage')}
                        >
                            {state.availableLanguages.map((language) => (
                                <button
                                    key={language}
                                    type="button"
                                    aria-label={t(`language.${language}`)}
                                    aria-pressed={state.language === language}
                                    disabled={state.isChangingLanguage}
                                    onClick={() =>
                                        void handler.handleLanguageChange(
                                            language,
                                        )
                                    }
                                    className={`min-h-9 min-w-10 rounded-lg px-2 font-semibold transition-colors disabled:opacity-50 ${state.language === language ? 'bg-primary text-marketplace-void' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                                >
                                    {language.toUpperCase()}
                                </button>
                            ))}
                        </div>
                        <span className="font-mono text-[10px]">
                            {state.appVersion}
                        </span>
                        <a
                            href="#main-content"
                            aria-label={t('marketplace.backToTop')}
                            className="grid h-9 w-9 place-items-center rounded-full border border-white/20 text-white transition-colors hover:border-primary hover:text-primary"
                        >
                            <ArrowUp aria-hidden="true" className="h-4 w-4" />
                        </a>
                    </div>
                </div>
            </div>
        </footer>
    )
}
