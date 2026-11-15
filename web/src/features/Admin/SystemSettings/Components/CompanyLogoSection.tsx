import Cropper from 'react-easy-crop'
import { ImageUp, Save, Upload } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import {
    applyImageFallback,
    DEFAULT_FAVICON_SRC,
    DEFAULT_IMAGE_SRC,
} from '@/lib/Images/imageFallbacks.ts'
import type { CompanyLogoSectionProps } from '../Types/system-settings-component-props.types.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function CompanyLogoSection({
    state,
    handler,
}: CompanyLogoSectionProps) {
    const { t } = useTranslationStore()

    return (
        <div className="h-full">
            <section className="h-full rounded-xl border border-border-dark bg-surface-dark p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <HeadingIcon icon={ImageUp} />
                        <div>
                            <h2 className="text-lg font-bold text-white">
                                {t('admin.systemSettings.companyLogo')}
                            </h2>
                            <p className="mt-1 text-sm text-secondary-text">
                                {t(
                                    'admin.systemSettings.companyLogoDescription',
                                )}
                            </p>
                        </div>
                    </div>
                    <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-input-dark px-4 text-sm font-semibold text-white transition-colors hover:border-primary/40">
                        <Upload className="h-4 w-4" />
                        {t('admin.systemSettings.logoChoose')}
                        <input
                            type="file"
                            accept={IMAGE_UPLOAD_CONFIG.allowedMimeTypes.join(
                                ',',
                            )}
                            className="hidden"
                            onChange={(event) =>
                                handler.handleSelectLogo(
                                    event.target.files?.[0] ?? null,
                                )
                            }
                        />
                    </label>
                </div>

                <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="relative flex min-h-105 items-center justify-center overflow-hidden rounded-xl border border-border-dark bg-background-dark">
                        {state.selectedLogoDataUrl ? (
                            <Cropper
                                image={state.selectedLogoDataUrl}
                                crop={state.crop}
                                zoom={state.zoom}
                                aspect={1}
                                showGrid={false}
                                cropShape="rect"
                                classes={{ cropAreaClassName: 'rounded-md' }}
                                onCropChange={handler.handleCropChange}
                                onZoomChange={handler.handleZoomChange}
                                onCropComplete={handler.handleCropComplete}
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center p-10">
                                <img
                                    src={state.logoPreviewSrc}
                                    alt={t('admin.systemSettings.logoAlt')}
                                    onError={(event) =>
                                        applyImageFallback(
                                            event,
                                            DEFAULT_IMAGE_SRC,
                                        )
                                    }
                                    className="max-h-72 w-full object-contain"
                                />
                            </div>
                        )}
                    </div>

                    <div className="space-y-4 rounded-xl border border-border-dark bg-input-dark/50 p-4">
                        <div>
                            <h3 className="text-sm font-semibold text-white">
                                {t('admin.systemSettings.preview')}
                            </h3>
                            <div className="mt-3 flex h-44 items-center justify-center rounded-lg border border-border-dark bg-background-dark p-5">
                                <img
                                    src={
                                        state.selectedLogoDataUrl ??
                                        state.logoPreviewSrc
                                    }
                                    alt={t('admin.systemSettings.logoPreview')}
                                    onError={(event) =>
                                        applyImageFallback(
                                            event,
                                            DEFAULT_FAVICON_SRC,
                                        )
                                    }
                                    className="h-full w-full object-contain"
                                />
                            </div>
                        </div>

                        {state.selectedLogoDataUrl && (
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
                        )}
                        {state.selectedLogoDataUrl && (
                            <button
                                type="button"
                                onClick={handler.handleResetSelectedLogo}
                                className="h-10 w-full cursor-pointer rounded-md border border-border-dark bg-background-dark px-4 text-sm font-semibold text-secondary-text transition-colors hover:text-white"
                            >
                                {t('common.removeSelection')}
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={
                                state.isSavingLogo || !state.selectedLogoDataUrl
                            }
                            onClick={handler.handleSaveLogo}
                            className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Save className="h-4 w-4" />
                            {state.isSavingLogo
                                ? t('common.saving')
                                : t('admin.systemSettings.logoSave')}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    )
}
