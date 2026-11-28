import { USER_THEME_MODES } from '@/config/user-theme-colors.config.ts'
import { Moon, Sun } from 'lucide-react'
import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useMainThemeLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useMainThemeLogic.ts'

export default function MainTheme() {
    const { t } = useTranslationStore()
    const { state, handler } = useMainThemeLogic()

    return (
        <section className="rounded-lg border border-border-dark bg-input-dark/50 p-4">
            <div className="flex items-center gap-2">
                <Moon className="h-4 w-4 text-primary" />

                <h3 className="text-sm font-semibold text-white">
                    {t('userSettings.theme.title')}
                </h3>
            </div>

            <p className="mt-1 text-sm text-secondary-text">
                {t('userSettings.theme.description')}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
                {USER_THEME_MODES.map((availableThemeMode) => {
                    const isSelected =
                        state.selectedThemeMode === availableThemeMode

                    const Icon = availableThemeMode === 'dark' ? Moon : Sun

                    return (
                        <button
                            key={availableThemeMode}
                            type="button"
                            onClick={() =>
                                handler.handleThemeModeChange(
                                    availableThemeMode,
                                )
                            }
                            className={[
                                'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border-2 px-3 font-comic text-sm font-bold transition-[color,border-color,transform]',
                                isSelected
                                    ? 'comic-selected'
                                    : 'border-border-dark bg-background-dark text-secondary-text hover:-translate-x-px hover:-translate-y-px hover:border-primary hover:text-foreground',
                            ].join(' ')}
                        >
                            <span className="flex items-center justify-center">
                                <Icon className="h-4 w-4" />
                            </span>

                            <span>
                                {t(`userSettings.theme.${availableThemeMode}`)}
                            </span>
                        </button>
                    )
                })}
            </div>

            <div className="mt-4 flex justify-end">
                <SettingsSaveButton
                    disabled={state.isSavingThemeMode}
                    isSaving={state.isSavingThemeMode}
                    onClick={handler.handleSaveThemeMode}
                >
                    {state.isSavingThemeMode
                        ? t('common.saving')
                        : t('userSettings.theme.save')}
                </SettingsSaveButton>
            </div>
        </section>
    )
}
