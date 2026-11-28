import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { FLAG_IMAGES } from '@/config/language.config.ts'
import useLanguageSettingsLogic from '../Hooks/useLanguageSettingsLogic.ts'

export default function LanguageSection() {
    const { t } = useTranslationStore()
    const { state, handler, setter } = useLanguageSettingsLogic()

    return (
        <section className="rounded-lg border border-border-dark bg-input-dark/50 p-4">
            <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">
                    {t('language.sectionTitle')}
                </h3>
            </div>

            <p className="mt-1 text-sm text-secondary-text">
                {t('language.sectionDescription')}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
                {state.availableLanguages.map((availableLanguage) => {
                    const isSelected =
                        state.selectedLanguage === availableLanguage
                    const flagImage = FLAG_IMAGES[availableLanguage]

                    return (
                        <button
                            key={availableLanguage}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() =>
                                setter.setSelectedLanguage(availableLanguage)
                            }
                            className={[
                                'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border-2 px-3 font-comic text-sm font-bold transition-[color,border-color,transform]',
                                isSelected
                                    ? 'comic-selected'
                                    : 'border-border-dark bg-background-dark text-secondary-text hover:-translate-x-px hover:-translate-y-px hover:border-primary hover:text-foreground',
                            ].join(' ')}
                        >
                            <img
                                src={flagImage}
                                alt=""
                                aria-hidden="true"
                                className="h-5 w-5 rounded-sm object-cover"
                            />
                            <span>{t(`language.${availableLanguage}`)}</span>
                        </button>
                    )
                })}
            </div>

            <div className="mt-4 flex justify-end">
                <SettingsSaveButton
                    disabled={
                        !state.hasLanguageChanged || state.isSavingLanguage
                    }
                    isSaving={state.isSavingLanguage}
                    onClick={() => void handler.handleSaveLanguage()}
                >
                    {state.isSavingLanguage
                        ? t('common.saving')
                        : t('language.save')}
                </SettingsSaveButton>
            </div>
        </section>
    )
}
