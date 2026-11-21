import { Link } from '@tanstack/react-router'
import { LogIn } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import LanguageSwitcher from './LanguageSwitcher.tsx'
import usePublicHeaderLogic from '../Hooks/usePublicHeaderLogic.ts'

export default function PublicHeader() {
    const { t } = useTranslationStore()
    const { state } = usePublicHeaderLogic()

    return (
        <header
            data-scrolled={state.isScrolled}
            className={`sticky top-0 z-50 border-b text-white transition-[background-color,border-color,box-shadow] duration-300 ease-out motion-reduce:transition-none ${state.isScrolled ? 'border-primary/20 bg-marketplace-void/95 shadow-[0_10px_35px_rgba(0,0,0,0.22)] backdrop-blur-xl' : 'border-white/10 bg-marketplace-void'}`}
        >
            <nav
                aria-label={t('marketplace.navigation.label')}
                className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 sm:gap-x-4 px-5 py-3 sm:px-8 lg:flex lg:gap-6 lg:px-12"
            >
                <Link
                    to="/"
                    className={`col-span-2 col-start-1 row-start-1 flex w-40 min-w-0 origin-left items-center transition-transform duration-300 ease-out motion-reduce:transition-none lg:w-52 ${state.isScrolled ? 'scale-[.94]' : 'scale-100'}`}
                    aria-label={t('marketplace.home')}
                >
                    <MarketplaceLogo
                        className="w-full"
                        sizes="(min-width: 1024px) 208px, 160px"
                    />
                </Link>
                <div className="col-start-1 row-start-2 flex items-center gap-3 sm:gap-4 lg:ml-6 lg:gap-6">
                    <Link
                        to="/apps"
                        className="py-2 text-xs font-medium text-white/75 sm:text-sm sm:font-semibold transition-colors hover:text-primary data-[status=active]:text-primary"
                    >
                        {t('marketplace.navigation.apps')}
                    </Link>
                    <Link
                        to="/blog"
                        className="py-2 text-xs font-medium text-white/75 sm:text-sm sm:font-semibold transition-colors hover:text-primary data-[status=active]:text-primary"
                    >
                        {t('marketplace.navigation.blog')}
                    </Link>
                </div>
                <div className="col-start-2 row-start-2 flex items-center justify-end gap-2 sm:gap-3 lg:ml-auto lg:gap-5">
                    <Link
                        to="/login"
                        aria-label={t('marketplace.login')}
                        title={t('marketplace.login')}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/15 text-white/80 transition-colors hover:border-primary/60 hover:text-primary sm:h-auto sm:w-auto sm:border-0 sm:py-2 sm:text-sm sm:font-semibold"
                    >
                        <LogIn
                            aria-hidden="true"
                            className="h-4 w-4 sm:hidden"
                        />
                        <span className="sr-only sm:not-sr-only">
                            {t('marketplace.login')}
                        </span>
                    </Link>
                    {state.isPublicRegistrationEnabled && (
                        <Link
                            to="/register"
                            className="inline-flex min-h-9 items-center justify-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-marketplace-void transition-colors hover:bg-primary-hover sm:px-4 sm:text-sm"
                        >
                            {t('marketplace.register')}
                        </Link>
                    )}
                </div>
                <div className="col-start-2 row-start-1 justify-self-end">
                    <LanguageSwitcher />
                </div>
            </nav>
        </header>
    )
}
