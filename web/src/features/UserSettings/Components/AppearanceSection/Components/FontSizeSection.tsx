import { Type } from 'lucide-react'
import {
    USER_FONT_FAMILY_STYLES,
    USER_FONT_SIZES,
} from '@/config/user-theme-colors.config.ts'
import useFontSizeLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useFontSizeLogic.ts'
import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function FontSizeSection() {
    const { t } = useTranslationStore()
    const { state, handler } = useFontSizeLogic()

    return (
        <section className="rounded-lg border border-border-dark bg-input-dark/50 p-4">
            <div className="flex items-center gap-2">
                <Type className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-white">
                    {t('userSettings.font.sizeTitle')}
                </h3>
            </div>
            <p className="mt-1 text-sm text-secondary-text">
                {t('userSettings.font.sizeDescription')}
            </p>

            <label className="mt-4 block">
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-secondary-text">
                        {t('userSettings.font.size')}
                    </span>
                    <span className="text-xs font-semibold text-white">
                        {t('userSettings.font.sizeValue', {
                            size: state.selectedFontSize,
                        })}
                    </span>
                </div>
                <input
                    type="range"
                    min={USER_FONT_SIZES[0]}
                    max={USER_FONT_SIZES[USER_FONT_SIZES.length - 1]}
                    step={1}
                    value={state.selectedFontSize}
                    onChange={(event) =>
                        handler.handleFontSizeChange(Number(event.target.value))
                    }
                    className="mt-2 w-full accent-primary"
                />
            </label>

            <div className="mt-4 rounded-lg border border-border-dark bg-background-dark p-3">
                <p className="text-xs font-semibold text-secondary-text">
                    {t('userSettings.font.sizePreview')}
                </p>
                <p
                    className="mt-1 font-semibold text-white"
                    style={{
                        fontFamily:
                            USER_FONT_FAMILY_STYLES[state.selectedFontFamily],
                        fontSize: state.selectedFontSize,
                    }}
                >
                    {t('userSettings.font.previewText')}
                </p>
            </div>

            <div className="mt-4 flex justify-end">
                <SettingsSaveButton
                    disabled={state.isSavingFontSize}
                    isSaving={state.isSavingFontSize}
                    onClick={handler.handleSaveFontSize}
                >
                    {state.isSavingFontSize
                        ? t('common.saving')
                        : t('userSettings.font.saveSize')}
                </SettingsSaveButton>
            </div>
        </section>
    )
}
