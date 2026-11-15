import useImageCropSelection from '@/shared/Images/Hooks/useImageCropSelection.ts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { ADMIN_SYSTEM_SETTINGS_QUERY_KEY } from '@/lib/Queries/appQueries.ts'
import { getDataUrlByteSize } from '@/lib/Images/imageDataUrlSize.ts'
import { startTransferTask } from '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts'
import { updateSystemLogoHandler } from '../middleware.ts'
import type { ImageCropPosition } from '@/shared/Types/image-crop.types.ts'

export default function useSystemLogoUpload() {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const selection = useImageCropSelection()
    const {
        imageSrc: selectedLogoDataUrl,
        crop,
        zoom,
        croppedAreaPixels,
    } = selection.state
    const { setCrop, setZoom } = selection.setter
    const {
        handleSelectImage: handleSelectLogo,
        handleCropComplete,
        handleResetSelection: handleResetSelectedLogo,
    } = selection.handler

    const { mutate: saveLogoMutation, isPending: isSavingLogo } = useMutation({
        mutationFn: async function () {
            if (!selectedLogoDataUrl || !croppedAreaPixels) {
                return {
                    success: false,
                    error: t('admin.systemSettings.logoMissing'),
                }
            }

            const transfer = startTransferTask({
                direction: 'upload',
                title: t('admin.systemSettings.logoUploadTitle'),
                totalBytes: getDataUrlByteSize(selectedLogoDataUrl),
            })

            try {
                const result = await updateSystemLogoHandler({
                    data: {
                        imageDataUrl: selectedLogoDataUrl,
                        crop: croppedAreaPixels,
                    },
                })

                transfer.complete(t('admin.systemSettings.logoUploaded'))

                return result
            } catch (error) {
                transfer.fail(t('admin.systemSettings.logoUploadFailed'))
                throw error
            }
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('admin.systemSettings.logoSaved'), {
                title: t('admin.systemSettings.toastTitle'),
            })
            selection.handler.handleClearSelectedImage()
            await queryClient.invalidateQueries({
                queryKey: ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
            })
        },
        onError: function (error) {
            toast.error(
                error instanceof Error && error.message
                    ? error.message
                    : t('admin.systemSettings.logoSaveError'),
                { title: t('common.error') },
            )
        },
    })

    function handleSaveLogo() {
        saveLogoMutation()
    }

    const handleCropChange: (nextCrop: ImageCropPosition) => void = setCrop

    const handleZoomChange: (nextZoom: number) => void = setZoom

    return {
        state: {
            selectedLogoDataUrl,
            crop,
            zoom,
            croppedAreaPixels,
            isSavingLogo,
        },
        handler: {
            handleSelectLogo,
            handleCropChange,
            handleZoomChange,
            handleCropComplete,
            handleSaveLogo,
            handleResetSelectedLogo,
        },
    }
}
