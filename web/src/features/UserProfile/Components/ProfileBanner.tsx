import Cropper from 'react-easy-crop'
import { CustomTooltip } from '@rentnerkev/tooltips'
import { ImagePlus, LoaderCircle, Save, Trash2 } from 'lucide-react'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import { USER_PROFILE_CONFIG } from '@/config/user-profile.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import MascotImage from '@/shared/Brand/MascotImage.tsx'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import useProfileBannerLogic from '../Hooks/useProfileBannerLogic.ts'
import type { ProfileBannerProps } from '../Types/user-profile.types.ts'

/** 3:1 banner; all editing controls sit inside it so nothing overlaps them. */
export default function ProfileBanner({
    bannerSrc,
    username,
}: ProfileBannerProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useProfileBannerLogic()

    return (
        <div className="relative aspect-[3/1] w-full overflow-hidden border-b-4 border-[var(--comic-edge,var(--color-ink))]">
            {state.imageSrc ? (
                <Cropper
                    image={state.imageSrc}
                    crop={state.crop}
                    zoom={state.zoom}
                    aspect={USER_PROFILE_CONFIG.bannerAspectRatio}
                    objectFit="horizontal-cover"
                    showGrid={false}
                    onCropChange={handler.handleCropChange}
                    onZoomChange={handler.handleZoomChange}
                    onCropComplete={handler.handleCropComplete}
                />
            ) : bannerSrc ? (
                <img
                    src={bannerSrc}
                    alt={t('profile.banner.alt', { username })}
                    className="h-full w-full object-cover"
                />
            ) : (
                <div
                    aria-hidden="true"
                    className="absolute inset-0 overflow-hidden bg-proxy-400"
                >
                    <div className="comic-rays absolute left-[78%] top-1/2 aspect-square w-[140%] -translate-x-1/2 -translate-y-1/2 [--rays-a:rgba(255,255,255,0.3)]" />
                    <div className="comic-hatch absolute bottom-0 left-0 h-2/3 w-1/2 [mask-image:linear-gradient(45deg,black,transparent_70%)]" />
                    <MascotImage
                        mascot="thumbsUp"
                        sizes="(min-width: 640px) 11rem, 8rem"
                        className="absolute -bottom-8 right-6 w-32 drop-shadow-[5px_5px_0_var(--color-ink)] sm:right-12 sm:w-44"
                    />
                </div>
            )}

            {state.imageSrc ? (
                <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
                    <p className="comic-chip pointer-events-auto max-w-sm text-xs">
                        {t('profile.banner.hint')}
                    </p>
                    <div className="pointer-events-auto flex flex-wrap items-center gap-2">
                        <label className="comic-chip h-10 gap-2 text-xs">
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
                                className="w-24 accent-ink sm:w-32"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={handler.handleCancelBanner}
                            className="comic-btn comic-btn-sm comic-btn-white"
                        >
                            {t('profile.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={handler.handleSaveBanner}
                            disabled={state.isSavingBanner}
                            className="comic-btn comic-btn-sm"
                        >
                            {state.isSavingBanner ? (
                                <LoaderCircle
                                    aria-hidden="true"
                                    className="h-4 w-4 animate-spin"
                                />
                            ) : (
                                <Save aria-hidden="true" className="h-4 w-4" />
                            )}
                            {t('profile.banner.save')}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="absolute right-3 top-3 z-10 flex gap-2 sm:right-4 sm:top-4">
                    <label className="comic-btn comic-btn-sm comic-btn-white cursor-pointer focus-within:outline-dashed focus-within:outline-[3px] focus-within:outline-offset-4 focus-within:outline-ink">
                        <ImagePlus aria-hidden="true" className="h-4 w-4" />
                        <span className="sr-only sm:not-sr-only">
                            {t('profile.banner.change')}
                        </span>
                        <input
                            type="file"
                            accept={IMAGE_UPLOAD_CONFIG.allowedMimeTypes.join(
                                ',',
                            )}
                            className="sr-only"
                            onChange={(event) =>
                                handler.handleSelectImage(
                                    event.target.files?.[0] ?? null,
                                )
                            }
                        />
                    </label>
                    {bannerSrc && (
                        <CustomTooltip
                            side="bottom"
                            content={t('profile.banner.remove')}
                        >
                            <button
                                type="button"
                                onClick={handler.handleOpenRemoveBanner}
                                disabled={state.isRemovingBanner}
                                aria-label={t('profile.banner.remove')}
                                className="comic-btn comic-btn-sm comic-btn-white size-10 px-0!"
                            >
                                {state.isRemovingBanner ? (
                                    <LoaderCircle
                                        aria-hidden="true"
                                        className="h-4 w-4 animate-spin"
                                    />
                                ) : (
                                    <Trash2
                                        aria-hidden="true"
                                        className="h-4 w-4"
                                    />
                                )}
                            </button>
                        </CustomTooltip>
                    )}
                </div>
            )}

            <SafeDeleteModal
                isOpen={state.isRemoveDialogOpen}
                title={t('profile.banner.removeTitle')}
                question={t('profile.banner.removeQuestion')}
                confirmLabel={t('profile.banner.remove')}
                isConfirming={state.isRemovingBanner}
                onClose={handler.handleCloseRemoveBanner}
                onConfirm={handler.handleConfirmRemoveBanner}
            />
        </div>
    )
}
