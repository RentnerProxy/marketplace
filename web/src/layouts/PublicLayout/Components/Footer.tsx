import { Link } from '@tanstack/react-router'
import { CustomTooltip } from '@rentnerkev/tooltips'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { FLAG_IMAGES } from '@/config/language.config.ts'
import useFooterLogic from '../Hooks/useFooterLogic.ts'

export default function Footer() {
    const { t } = useTranslationStore()
    const { state, handler } = useFooterLogic()
    const {
        availableLanguages,
        companyName,
        currentYear,
        isChangingLanguage,
        language,
    } = state

    return (
        <footer className="relative z-20 grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t border-border-dark bg-background-dark px-3 py-3">
            <div className="col-start-1 row-start-1 z-30 flex items-center justify-self-start gap-2">
                {availableLanguages.map((availableLanguage) => {
                    const isSelected = language === availableLanguage
                    const flagImage = FLAG_IMAGES[availableLanguage]

                    return (
                        <CustomTooltip
                            key={availableLanguage}
                            content={t(`language.${availableLanguage}`)}
                            disabledTrigger={isChangingLanguage}
                        >
                            <button
                                type="button"
                                aria-label={t(`language.${availableLanguage}`)}
                                aria-pressed={isSelected}
                                disabled={isChangingLanguage}
                                onClick={() =>
                                    void handler.handleLanguageChange(
                                        availableLanguage,
                                    )
                                }
                                className={[
                                    'relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border-dark bg-input-dark px-2 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                    isSelected
                                        ? 'opacity-100'
                                        : 'opacity-70 hover:opacity-100',
                                ].join(' ')}
                            >
                                {isSelected && (
                                    <span
                                        aria-hidden="true"
                                        className="absolute inset-y-0 left-0 w-1 bg-primary"
                                    />
                                )}
                                <img
                                    src={flagImage}
                                    alt=""
                                    aria-hidden="true"
                                    className="h-4 w-6 rounded-sm object-cover"
                                />
                            </button>
                        </CustomTooltip>
                    )
                })}
            </div>

            <div className="col-span-3 row-start-2 flex flex-wrap items-center justify-center gap-3 text-xs font-medium text-secondary-text md:col-span-1 md:col-start-2 md:row-start-1 md:gap-5">
                <div>
                    <Link
                        to="/terms"
                        aria-label={t('layout.footer.terms')}
                        className="transition-colors hover:text-white"
                    >
                        {t('layout.footer.terms')}
                    </Link>
                </div>

                <span className="h-3 w-px bg-border-dark" />

                <div>
                    <Link
                        to="/"
                        aria-label={companyName}
                        className="flex items-center transition-colors hover:text-white"
                    >
                        &copy; {currentYear} {companyName}
                    </Link>
                </div>

                <span className="h-3 w-px bg-border-dark" />

                <div>
                    <Link
                        to="/privacy"
                        aria-label={t('layout.footer.privacy')}
                        className="transition-colors hover:text-white"
                    >
                        {t('layout.footer.privacy')}
                    </Link>
                </div>
            </div>

            <div className="col-start-3 row-start-1 shrink-0 justify-self-end">
                <div className="rounded-md border border-border-dark bg-input-dark px-2.5 py-1 font-mono text-[10px] text-secondary-text">
                    {state.appVersion}
                </div>
            </div>
        </footer>
    )
}
