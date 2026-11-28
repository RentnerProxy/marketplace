import { Link } from '@tanstack/react-router'
import { CustomTooltip } from '@rentnerkev/tooltips'
import { LogIn } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import LanguageSwitcher from './LanguageSwitcher.tsx'
import usePublicHeaderLogic from '../Hooks/usePublicHeaderLogic.ts'

const navigationLinkClassName =
    'comic-lettering comic-focus inline-flex min-h-11 items-center rounded-sm text-sm whitespace-nowrap text-white decoration-proxy-400 decoration-wavy decoration-2 underline-offset-[6px] transition-colors hover:text-proxy-300 hover:underline data-[status=active]:text-proxy-300 data-[status=active]:underline'

export default function PublicHeader() {
    const { t } = useTranslationStore()
    const { state } = usePublicHeaderLogic()

    return (
        <header
            data-scrolled={state.isScrolled}
            className="sticky top-0 z-50 px-2 pt-2 sm:px-4 sm:pt-3"
        >
            <nav
                aria-label={t('marketplace.navigation.label')}
                className={`comic-dark mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border-[3px] border-ink px-3 transition-[padding,box-shadow] duration-300 motion-reduce:transition-none sm:gap-x-4 sm:px-5 lg:flex lg:gap-6 lg:px-6 ${state.isScrolled ? 'py-1.5 shadow-[5px_5px_0_0_var(--color-proxy-500)]' : 'py-2.5 shadow-[3px_3px_0_0_var(--color-proxy-500)]'}`}
            >
                <Link
                    to="/"
                    className={`comic-focus col-start-1 row-start-1 flex min-w-0 origin-left items-center rounded-md transition-transform duration-300 ease-out motion-reduce:transition-none ${state.isScrolled ? 'scale-[.9]' : 'scale-100'}`}
                    aria-label={t('marketplace.home')}
                >
                    <MarketplaceLogo priority />
                </Link>
                <div className="col-start-1 row-start-2 flex items-center gap-5 lg:ml-6 lg:gap-6">
                    <Link to="/apps" className={navigationLinkClassName}>
                        {t('marketplace.navigation.apps')}
                    </Link>
                    <Link to="/blog" className={navigationLinkClassName}>
                        {t('marketplace.navigation.blog')}
                    </Link>
                </div>
                <div className="col-start-2 row-start-2 flex items-center justify-end gap-2 sm:gap-3 lg:ml-auto lg:gap-4">
                    <CustomTooltip
                        side="bottom"
                        content={t('marketplace.login')}
                    >
                        <Link
                            to="/login"
                            aria-label={t('marketplace.login')}
                            className="comic-btn comic-btn-sm comic-btn-white size-10 px-0! sm:size-auto sm:px-[0.9rem]!"
                        >
                            <LogIn
                                aria-hidden="true"
                                className="h-4 w-4 sm:hidden"
                            />
                            <span className="sr-only sm:not-sr-only">
                                {t('marketplace.login')}
                            </span>
                        </Link>
                    </CustomTooltip>
                    {state.isPublicRegistrationEnabled && (
                        <Link to="/register" className="comic-btn comic-btn-sm">
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
