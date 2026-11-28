import { ImagePlus, Trash2 } from 'lucide-react'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import ImageCropDialog from '@/shared/Images/Components/ImageCropDialog.tsx'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import useStoreLogoLogic from '../Hooks/useStoreLogoLogic.ts'
import type { StoreLogoEditorProps } from '../Types/app-store-component.types.ts'
import AppLogo from './AppLogo.tsx'

export default function StoreLogoEditor({
    appId,
    logoSrc,
    name,
}: StoreLogoEditorProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useStoreLogoLogic(appId)

    return (
        <section
            aria-labelledby="store-logo-title"
            className="rounded-lg border border-border-dark bg-surface-dark p-5 sm:p-6"
        >
            <h2 id="store-logo-title" className="comic-title text-3xl">
                {t('appStore.logo.title')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-secondary-text">
                {t('appStore.logo.hint')}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-5">
                <AppLogo logoSrc={logoSrc} name={name} size="lg" />
                <div className="flex flex-wrap gap-3">
                    <label className="comic-btn comic-btn-sm cursor-pointer focus-within:outline-dashed focus-within:outline-2 focus-within:outline-offset-4">
                        <ImagePlus aria-hidden="true" className="h-4 w-4" />
                        {logoSrc
                            ? t('appStore.logo.change')
                            : t('appStore.logo.upload')}
                        <input
                            type="file"
                            accept={IMAGE_UPLOAD_CONFIG.allowedMimeTypes.join(
                                ',',
                            )}
                            className="sr-only"
                            onChange={(event) => {
                                handler.handleSelectImage(
                                    event.target.files?.[0] ?? null,
                                )
                                event.target.value = ''
                            }}
                        />
                    </label>
                    {logoSrc && (
                        <button
                            type="button"
                            onClick={handler.handleOpenRemoveLogo}
                            className="comic-btn comic-btn-sm comic-btn-white"
                        >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                            {t('appStore.logo.remove')}
                        </button>
                    )}
                </div>
            </div>

            {state.imageSrc && (
                <ImageCropDialog
                    titleId="store-logo-crop-title"
                    title={t('appStore.logo.cropTitle')}
                    hint={t('appStore.cropHint')}
                    imageSrc={state.imageSrc}
                    crop={state.crop}
                    zoom={state.zoom}
                    aspect={1}
                    isSaving={state.isSavingLogo}
                    saveLabel={t('appStore.logo.save')}
                    onCropChange={handler.handleCropChange}
                    onZoomChange={handler.handleZoomChange}
                    onCropComplete={handler.handleCropComplete}
                    onCancel={handler.handleCancelLogo}
                    onSave={handler.handleSaveLogo}
                />
            )}

            <SafeDeleteModal
                isOpen={state.isRemoveDialogOpen}
                title={t('appStore.logo.removeTitle')}
                question={t('appStore.logo.removeQuestion')}
                confirmLabel={t('appStore.logo.remove')}
                isConfirming={state.isRemovingLogo}
                onClose={handler.handleCloseRemoveLogo}
                onConfirm={handler.handleConfirmRemoveLogo}
            />
        </section>
    )
}
