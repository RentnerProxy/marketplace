import { Type } from 'lucide-react'
import {
    USER_FONT_FAMILIES,
    USER_FONT_FAMILY_STYLES,
} from '@/config/user-theme-colors.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useFontsLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useFontsLogic.ts'
import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'

export default function FontsSection() {
    const { t } = useTranslationStore()

    const { handler, state } = useFontsLogic()

    return (
        <section className="rounded-lg border border-border-dark bg-input-dark/50 p-4">
            <div className="flex items-center gap-2">
                <Type className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-white">
                    {t('userSettings.font.familyTitle')}
                </h3>
            </div>
            <p className="mt-1 text-sm text-secondary-text">
                {t('userSettings.font.familyDescription')}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
                {USER_FONT_FAMILIES.map((availableFontFamily) => {
                    const isSelected =
                        state.selectedFontFamily === availableFontFamily

                    return (
                        <button
                            key={availableFontFamily}
                            type="button"
                            onClick={() =>
                                handler.handleFontFamilyChange(
                                    availableFontFamily,
                                )
                            }
                            className={`flex h-11 cursor-pointer items-center justify-center rounded-md border-2 px-3 text-sm font-semibold transition-[color,border-color,transform] ${
                                isSelected
                                    ? 'comic-selected'
                                    : 'border-border-dark bg-background-dark text-secondary-text hover:-translate-x-px hover:-translate-y-px hover:border-primary hover:text-foreground'
                            }`}
                            style={{
                                fontFamily:
                                    USER_FONT_FAMILY_STYLES[
                                        availableFontFamily
                                    ],
                            }}
                        >
                            {t(
                                `userSettings.font.family.${availableFontFamily}`,
                            )}
                        </button>
                    )
                })}
            </div>

            <div className="mt-4 rounded-lg border border-border-dark bg-background-dark p-4">
                <p
                    className="text-sm font-semibold text-white"
                    style={{
                        fontFamily:
                            USER_FONT_FAMILY_STYLES[state.selectedFontFamily],
                    }}
                >
                    {t('userSettings.font.preview')}
                </p>
                <p
                    className="mt-1 text-sm text-secondary-text"
                    style={{
                        fontFamily:
                            USER_FONT_FAMILY_STYLES[state.selectedFontFamily],
                    }}
                >
                    {t('userSettings.font.previewText')}
                </p>
            </div>

            <div className="mt-4 flex justify-end">
                <SettingsSaveButton
                    disabled={state.isSavingFontFamily}
                    isSaving={state.isSavingFontFamily}
                    onClick={handler.handleSaveFontFamily}
                >
                    {state.isSavingFontFamily
                        ? t('common.saving')
                        : t('userSettings.font.saveFamily')}
                </SettingsSaveButton>
            </div>
        </section>
    )
}
