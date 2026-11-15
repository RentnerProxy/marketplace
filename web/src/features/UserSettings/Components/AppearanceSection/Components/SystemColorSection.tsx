import { CustomColorPicker } from '@rentnerkev/picker'
import { RotateCcw } from 'lucide-react'
import useSystemColorLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useSystemColorLogic.ts'
import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function SystemColorSection() {
    const { t, language } = useTranslationStore()
    const { state, handler } = useSystemColorLogic()

    return (
        <section className="rounded-lg border border-border-dark bg-input-dark/50 p-4">
            <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full bg-primary" />
                <h3 className="text-sm font-semibold text-white">
                    {t('userSettings.color.title')}
                </h3>
            </div>

            <p className="mt-1 text-sm text-secondary-text">
                {t('userSettings.color.description')}
            </p>

            <div className="mt-4">
                <CustomColorPicker
                    key={state.primaryColorResetKey}
                    id="primary-color"
                    name="primaryColor"
                    value={state.selectedPrimaryColor}
                    onValueChange={handler.handlePrimaryColorChange}
                    onValidityChange={handler.handlePrimaryColorValidityChange}
                    locale={language}
                    disabled={state.isSavingPrimaryColor}
                    placeholder="#13ecd6"
                    format="hex"
                    presets={state.colorPresets}
                    showInput
                    showPresets
                />
            </div>

            <div className="mt-4 rounded-lg border border-border-dark bg-background-dark p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                    <div className="space-y-3">
                        <div
                            className="h-10 rounded-md px-4 py-2 text-sm font-semibold"
                            style={{
                                backgroundColor: state.selectedPrimaryColor,
                                color: state.selectedPrimaryColorForeground,
                            }}
                        >
                            {t('userSettings.color.primaryButton')}
                        </div>

                        <div className="h-10 rounded-md border border-border-dark bg-input-dark px-4 py-2 text-sm font-semibold text-secondary-text">
                            {t('userSettings.color.secondaryButton')}
                        </div>

                        <div className="flex gap-2">
                            <div
                                className="h-9 flex-1 rounded-md"
                                style={{
                                    backgroundColor: state.selectedPrimaryColor,
                                }}
                            />

                            <div
                                className="h-9 flex-1 rounded-md border"
                                style={{
                                    borderColor: state.selectedPrimaryColor,
                                    backgroundColor:
                                        state.selectedPrimaryColorTransparent,
                                }}
                            />

                            <div
                                className="h-9 flex-1 rounded-md"
                                style={{
                                    backgroundColor:
                                        state.selectedPrimaryColorHover,
                                }}
                            />
                        </div>
                    </div>

                    <div className="rounded-md border border-border-dark bg-surface-dark p-2">
                        <div className="mb-2 h-2 w-16 rounded-full bg-secondary-text/50" />

                        <div
                            className="h-8 rounded-md"
                            style={{
                                backgroundColor: state.selectedPrimaryColor,
                            }}
                        />

                        <div className="mt-2 h-8 rounded-md bg-input-dark" />

                        <div className="mt-2 flex gap-1">
                            <div
                                className="h-4 flex-1 rounded"
                                style={{
                                    backgroundColor: state.selectedPrimaryColor,
                                }}
                            />

                            <div
                                className="h-4 flex-1 rounded"
                                style={{
                                    backgroundColor:
                                        state.selectedPrimaryColorHover,
                                }}
                            />

                            <div
                                className="h-4 flex-1 rounded"
                                style={{
                                    backgroundColor:
                                        state.selectedPrimaryColorTransparent,
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                    type="button"
                    disabled={state.isSavingPrimaryColor}
                    onClick={handler.handleResetPrimaryColor}
                    className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-background-dark px-4 text-sm font-semibold text-secondary-text transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <RotateCcw className="h-4 w-4" />
                    {t('userSettings.color.reset')}
                </button>

                <SettingsSaveButton
                    disabled={
                        state.isSavingPrimaryColor || !state.isPrimaryColorValid
                    }
                    isSaving={state.isSavingPrimaryColor}
                    onClick={handler.handleSavePrimaryColor}
                >
                    {state.isSavingPrimaryColor
                        ? t('common.saving')
                        : t('userSettings.color.save')}
                </SettingsSaveButton>
            </div>
        </section>
    )
}
