import { Trash2 } from 'lucide-react'
import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'
import type { CustomBackgroundControlsProps } from '../Types/custom-background-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function CustomBackgroundControls({
    handler,
    state,
}: CustomBackgroundControlsProps) {
    const { t } = useTranslationStore()

    return (
        <>
            {state.backgroundImageSrc && (
                <label className="mt-4 block">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-secondary-text">
                            {t('userSettings.background.zoom')}
                        </span>
                        <span className="text-xs font-semibold text-white">
                            {t('userSettings.background.zoomValue', {
                                zoom: state.backgroundZoom.toFixed(1),
                            })}
                        </span>
                    </div>

                    <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.1}
                        value={state.backgroundZoom}
                        onChange={(event) =>
                            handler.handleBackgroundZoomChange(
                                Number(event.target.value),
                            )
                        }
                        className="mt-2 w-full accent-primary"
                    />
                </label>
            )}

            {(state.backgroundImageSrc || state.customBackgroundSrc) && (
                <label className="mt-4 block">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-secondary-text">
                            {t('userSettings.background.darkness')}
                        </span>
                        <span className="text-xs font-semibold text-white">
                            {state.customBackgroundDarknessValue}%
                        </span>
                    </div>

                    <input
                        type="range"
                        min={0}
                        max={95}
                        step={5}
                        value={state.customBackgroundDarknessValue}
                        onChange={(event) =>
                            handler.handleBackgroundDarknessChange(
                                Number(event.target.value),
                            )
                        }
                        className="mt-2 w-full accent-primary"
                    />
                </label>
            )}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
                {state.hasCustomBackground && (
                    <SettingsSaveButton
                        disabled={state.isSavingBackgroundAppearance}
                        isSaving={state.isSavingBackgroundAppearance}
                        onClick={handler.handleSaveBackgroundAppearance}
                        variant="secondary"
                    >
                        {state.isSavingBackgroundAppearance
                            ? t('common.saving')
                            : t('userSettings.background.saveBrightness')}
                    </SettingsSaveButton>
                )}

                {state.backgroundImageSrc && (
                    <button
                        type="button"
                        onClick={handler.handleResetSelectedBackgroundImage}
                        className="flex h-11 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-background-dark px-4 text-sm font-semibold text-secondary-text transition-colors hover:text-white"
                    >
                        {t('common.removeSelection')}
                    </button>
                )}

                {state.hasCustomBackground && (
                    <button
                        type="button"
                        disabled={state.isDeletingBackgroundImage}
                        onClick={handler.handleDeleteBackgroundImage}
                        className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-background-dark px-4 text-sm font-semibold text-danger transition-colors hover:border-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <Trash2 className="h-4 w-4" />
                        {state.isDeletingBackgroundImage
                            ? t('userSettings.background.removing')
                            : t('userSettings.background.remove')}
                    </button>
                )}

                <SettingsSaveButton
                    disabled={
                        !state.backgroundImageSrc ||
                        !state.backgroundCroppedAreaPixels ||
                        state.isSavingBackgroundImage
                    }
                    isSaving={state.isSavingBackgroundImage}
                    onClick={handler.handleSaveBackgroundImage}
                >
                    {state.isSavingBackgroundImage
                        ? t('common.saving')
                        : t('userSettings.background.save')}
                </SettingsSaveButton>
            </div>
        </>
    )
}
