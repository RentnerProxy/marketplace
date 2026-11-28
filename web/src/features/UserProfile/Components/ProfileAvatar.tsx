import { CustomTooltip } from '@rentnerkev/tooltips'
import { createPortal } from 'react-dom'
import Cropper from 'react-easy-crop'
import { Camera } from 'lucide-react'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import useProfileImageSettingsLogic from '@/features/UserSettings/Components/Account/Hooks/useProfileImageSettingsLogic.ts'
import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'
import useResolvedImageSrc from '@/shared/Images/Hooks/useResolvedImageSrc.ts'
import type { ProfileAvatarProps } from '../Types/user-profile.types.ts'

/** Clickable avatar: choosing an image opens a round crop dialog. */
export default function ProfileAvatar({
    profileImageSrc,
    userId,
    username,
}: ProfileAvatarProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useProfileImageSettingsLogic(userId)
    const profileImage = useResolvedImageSrc(
        profileImageSrc || DEFAULT_IMAGE_SRC,
        DEFAULT_IMAGE_SRC,
    )

    return (
        <>
            <CustomTooltip side="right" content={t('profile.avatar.change')}>
                <label className="group relative z-10 block h-28 w-28 shrink-0 cursor-pointer rounded-full focus-within:outline-dashed focus-within:outline-[3px] focus-within:outline-offset-4 focus-within:outline-ink sm:h-40 sm:w-40">
                    <img
                        src={profileImage.state.imageSrc || DEFAULT_IMAGE_SRC}
                        alt={username}
                        onError={profileImage.handler.handleImageError}
                        className="h-full w-full rounded-full border-4 border-ink bg-mist-100 object-cover shadow-[4px_4px_0_0_var(--app-comic-pop,var(--color-ink))]"
                    />
                    <span
                        aria-hidden="true"
                        className="absolute inset-1 grid place-items-center rounded-full bg-ink/55 text-mist-50 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                    >
                        <Camera className="h-8 w-8" />
                    </span>
                    <span
                        aria-hidden="true"
                        className="absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full border-2 border-ink bg-primary text-primary-foreground shadow-[2px_2px_0_0_var(--color-ink)] sm:bottom-2 sm:right-2"
                    >
                        <Camera className="h-4 w-4" />
                    </span>
                    <span className="sr-only">
                        {t('profile.avatar.change')}
                    </span>
                    <input
                        type="file"
                        accept={IMAGE_UPLOAD_CONFIG.allowedMimeTypes.join(',')}
                        className="sr-only"
                        onChange={(event) =>
                            handler.handleSelectImage(
                                event.target.files?.[0] ?? null,
                            )
                        }
                    />
                </label>
            </CustomTooltip>

            {state.imageSrc &&
                createPortal(
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="profile-avatar-crop-title"
                        className="fixed inset-0 z-100 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
                    >
                        <div className="comic-panel w-full max-w-md bg-surface-dark p-5 text-foreground sm:p-6">
                            <h2
                                id="profile-avatar-crop-title"
                                className="comic-title text-4xl"
                            >
                                {t('profile.avatar.cropTitle')}
                            </h2>
                            <p className="mt-2 text-sm text-secondary-text">
                                {t('profile.avatar.hint')}
                            </p>
                            <div className="relative mt-4 h-72 overflow-hidden rounded-md border-2 border-border-dark bg-background-dark">
                                <Cropper
                                    image={state.imageSrc}
                                    crop={state.crop}
                                    zoom={state.zoom}
                                    aspect={1}
                                    cropShape="round"
                                    showGrid={false}
                                    onCropChange={handler.handleCropChange}
                                    onZoomChange={handler.handleZoomChange}
                                    onCropComplete={handler.handleCropComplete}
                                />
                            </div>
                            <label className="mt-4 flex items-center gap-3 font-comic text-xs font-bold text-secondary-text">
                                {t('common.zoom')}
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
                                    className="flex-1 accent-primary"
                                />
                            </label>
                            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                                <button
                                    type="button"
                                    onClick={handler.handleResetSelectedImage}
                                    className="flex h-11 cursor-pointer items-center justify-center rounded-md border-2 border-border-dark bg-background-dark px-4 font-comic text-sm font-bold text-secondary-text transition-colors hover:border-primary hover:text-foreground"
                                >
                                    {t('profile.cancel')}
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
                    </div>,
                    document.body,
                )}
        </>
    )
}
