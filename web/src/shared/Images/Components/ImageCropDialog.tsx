import { createPortal } from 'react-dom'
import Cropper from 'react-easy-crop'
import { LoaderCircle } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { ImageCropDialogProps } from '../Types/image-crop-dialog.types.ts'

/** Modal crop step before an image upload, in the comic panel style. */
export default function ImageCropDialog({
    titleId,
    title,
    hint,
    imageSrc,
    crop,
    zoom,
    aspect,
    isSaving,
    saveLabel,
    onCropChange,
    onZoomChange,
    onCropComplete,
    onCancel,
    onSave,
}: ImageCropDialogProps) {
    const { t } = useTranslationStore()

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="fixed inset-0 z-100 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
        >
            <div className="comic-panel w-full max-w-2xl bg-surface-dark p-5 text-foreground sm:p-6">
                <h2 id={titleId} className="comic-title text-4xl">
                    {title}
                </h2>
                <p className="mt-2 text-sm text-secondary-text">{hint}</p>
                <div className="relative mt-4 h-80 overflow-hidden rounded-md border-2 border-border-dark bg-background-dark">
                    <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        aspect={aspect}
                        showGrid={false}
                        onCropChange={onCropChange}
                        onZoomChange={onZoomChange}
                        onCropComplete={onCropComplete}
                    />
                </div>
                <label className="mt-4 flex items-center gap-3 font-comic text-xs font-bold text-secondary-text">
                    {t('common.zoom')}
                    <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.1}
                        value={zoom}
                        onChange={(event) =>
                            onZoomChange(Number(event.target.value))
                        }
                        className="flex-1 accent-primary"
                    />
                </label>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isSaving}
                        className="comic-btn comic-btn-white"
                    >
                        {t('profile.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={isSaving}
                        className="comic-btn"
                    >
                        {isSaving && (
                            <LoaderCircle
                                aria-hidden="true"
                                className="h-4 w-4 animate-spin"
                            />
                        )}
                        {isSaving ? t('common.saving') : saveLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
