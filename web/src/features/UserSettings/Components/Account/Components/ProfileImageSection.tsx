import { CustomTooltip } from '@rentnerkev/tooltips'
import { Check, Upload } from 'lucide-react'
import Cropper from 'react-easy-crop'
import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'
import useProfileImageSettingsLogic from '../Hooks/useProfileImageSettingsLogic.ts'
import type { ProfileImageSectionProps } from '../../../Types/user-settings-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'
import useResolvedImageSrc from '@/shared/Images/Hooks/useResolvedImageSrc.ts'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'

export default function ProfileImageSection({
    profileImageSrc,
    userId,
    username,
}: ProfileImageSectionProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useProfileImageSettingsLogic(userId)
    const profileImage = useResolvedImageSrc(
        profileImageSrc || DEFAULT_IMAGE_SRC,
        DEFAULT_IMAGE_SRC,
    )

    return (
        <section className="w-full rounded-lg border border-border-dark bg-input-dark/50 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-white">
                        {t('userSettings.profileImage.title')}
                    </h3>
                    <p className="mt-1 text-sm text-secondary-text">
                        {t('userSettings.profileImage.description')}
                    </p>
                </div>
                <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60">
                    <Upload className="h-4 w-4" />
                    {t('userSettings.profileImage.choose')}
                    <input
                        type="file"
                        accept={IMAGE_UPLOAD_CONFIG.allowedMimeTypes.join(',')}
                        className="hidden"
                        onChange={(event) =>
                            handler.handleSelectImage(
                                event.target.files?.[0] ?? null,
                            )
                        }
                    />
                </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[160px_1fr]">
                <div className="space-y-3">
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border-dark bg-input-dark">
                        <img
                            src={
                                profileImage.state.imageSrc || DEFAULT_IMAGE_SRC
                            }
                            alt={username}
                            onError={profileImage.handler.handleImageError}
                            className="h-full w-full object-cover"
                        />
                    </div>
                    <CustomTooltip
                        content={
                            state.copy
                                ? t('common.copied')
                                : t('common.clickToCopy')
                        }
                        side="bottom"
                    >
                        <div
                            onClick={handler.handleCopy}
                            className="flex cursor-pointer items-center justify-center gap-1.5 transition-transform hover:scale-105"
                        >
                            <p className="break-all text-xs text-secondary-text">
                                {t('userSettings.profileImage.userId', {
                                    userId,
                                })}
                            </p>
                            {state.copy && (
                                <Check className="h-3.5 w-3.5 text-emerald-500 transition-all duration-300 ease-in-out" />
                            )}
                        </div>
                    </CustomTooltip>
                </div>

                {state.imageSrc ? (
                    <div className="space-y-4">
                        <div className="relative h-72 overflow-hidden rounded-lg border border-border-dark bg-background-dark">
                            <Cropper
                                image={state.imageSrc}
                                crop={state.crop}
                                zoom={state.zoom}
                                aspect={1}
                                cropShape="rect"
                                classes={{
                                    cropAreaClassName: 'rounded-md',
                                }}
                                showGrid={false}
                                onCropChange={handler.handleCropChange}
                                onZoomChange={handler.handleZoomChange}
                                onCropComplete={handler.handleCropComplete}
                            />
                        </div>

                        <label className="block">
                            <span className="text-xs font-semibold text-secondary-text">
                                {t('common.zoom')}
                            </span>
                            <input
                                type="range"
                                min={1}
                                max={3}
                                step={0.1}
                                value={state.zoom}
                                onChange={(event) =>
                                    handler.handleZoomChange(
                                        Number(event.target.value),
                                    )
                                }
                                className="mt-2 w-full accent-primary"
                            />
                        </label>

                        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={handler.handleResetSelectedImage}
                                className="flex h-11 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-background-dark px-4 text-sm font-semibold text-secondary-text transition-colors hover:text-white"
                            >
                                {t('common.removeSelection')}
                            </button>
                            <SettingsSaveButton
                                disabled={state.isSavingProfileImage}
                                isSaving={state.isSavingProfileImage}
                                onClick={handler.handleSaveProfileImage}
                            >
                                {state.isSavingProfileImage
                                    ? t('common.saving')
                                    : t('userSettings.profileImage.save')}
                            </SettingsSaveButton>
                        </div>
                    </div>
                ) : (
                    <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border-dark bg-background-dark/60 px-4 text-center text-sm text-secondary-text">
                        {t('userSettings.profileImage.empty')}
                    </div>
                )}
            </div>
        </section>
    )
}
