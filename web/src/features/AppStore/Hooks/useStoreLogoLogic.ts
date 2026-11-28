import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useImageCropSelection from '@/shared/Images/Hooks/useImageCropSelection.ts'
import {
    removeStoreLogoHandler,
    uploadStoreLogoHandler,
} from '../middleware.ts'
import type { StoreLogoLogicReturn } from '../Types/app-store-component.types.ts'
import useStoreMutationFeedback from './useStoreMutationFeedback.ts'

export default function useStoreLogoLogic(appId: string): StoreLogoLogicReturn {
    const { t } = useTranslationStore()
    const feedback = useStoreMutationFeedback()
    const selection = useImageCropSelection()
    const { imageSrc, croppedAreaPixels } = selection.state
    const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false)

    const uploadMutation = useMutation({
        mutationFn: async function () {
            if (!imageSrc || !croppedAreaPixels) {
                return { success: false as const, error: t('appStore.noImage') }
            }
            return feedback.runUpload(imageSrc, t('appStore.logo.save'), () =>
                uploadStoreLogoHandler({
                    data: {
                        appId,
                        imageDataUrl: imageSrc,
                        crop: croppedAreaPixels,
                    },
                }),
            )
        },
        onSuccess: async function (result) {
            if (await feedback.handleResult(result, 'appStore.logo.saved')) {
                selection.handler.handleResetSelection()
            }
        },
        onError: (error) => feedback.onError(error),
    })

    const removeMutation = useMutation({
        mutationFn: () => removeStoreLogoHandler({ data: { appId } }),
        onSuccess: async function (result) {
            if (await feedback.handleResult(result, 'appStore.logo.removed')) {
                setIsRemoveDialogOpen(false)
            }
        },
        onError: (error) => feedback.onError(error),
    })

    return {
        state: {
            imageSrc,
            crop: selection.state.crop,
            zoom: selection.state.zoom,
            isSavingLogo: uploadMutation.isPending,
            isRemoveDialogOpen,
            isRemovingLogo: removeMutation.isPending,
        },
        handler: {
            handleSelectImage: selection.handler.handleSelectImage,
            handleCropComplete: selection.handler.handleCropComplete,
            handleCropChange: selection.setter.setCrop,
            handleZoomChange: selection.setter.setZoom,
            handleCancelLogo: selection.handler.handleResetSelection,
            handleSaveLogo: () => uploadMutation.mutate(),
            handleOpenRemoveLogo: () => setIsRemoveDialogOpen(true),
            handleCloseRemoveLogo: () => setIsRemoveDialogOpen(false),
            handleConfirmRemoveLogo: () => removeMutation.mutate(),
        },
    }
}
