import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { APP_STORE_CONFIG } from '@/config/app-store.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useImageCropSelection from '@/shared/Images/Hooks/useImageCropSelection.ts'
import {
    addStoreScreenshotHandler,
    removeStoreScreenshotHandler,
    reorderStoreScreenshotsHandler,
} from '../middleware.ts'
import type { StoreScreenshotsLogicReturn } from '../Types/app-store-component.types.ts'
import type { StoreScreenshot } from '../Types/app-store.types.ts'
import useStoreMutationFeedback from './useStoreMutationFeedback.ts'

export default function useStoreScreenshotsLogic(
    appId: string,
    screenshots: Array<StoreScreenshot>,
): StoreScreenshotsLogicReturn {
    const { t } = useTranslationStore()
    const feedback = useStoreMutationFeedback()
    const selection = useImageCropSelection()
    const { imageSrc, croppedAreaPixels } = selection.state
    const [removeId, setRemoveId] = useState<string | null>(null)

    const addMutation = useMutation({
        mutationFn: async function () {
            if (!imageSrc || !croppedAreaPixels) {
                return { success: false as const, error: t('appStore.noImage') }
            }
            return feedback.runUpload(
                imageSrc,
                t('appStore.screenshots.save'),
                () =>
                    addStoreScreenshotHandler({
                        data: {
                            appId,
                            imageDataUrl: imageSrc,
                            crop: croppedAreaPixels,
                        },
                    }),
            )
        },
        onSuccess: async function (result) {
            if (
                await feedback.handleResult(
                    result,
                    'appStore.screenshots.saved',
                )
            ) {
                selection.handler.handleResetSelection()
            }
        },
        onError: (error) => feedback.onError(error),
    })

    const removeMutation = useMutation({
        mutationFn: (screenshotId: string) =>
            removeStoreScreenshotHandler({ data: { appId, screenshotId } }),
        onSuccess: async function (result) {
            if (
                await feedback.handleResult(
                    result,
                    'appStore.screenshots.removed',
                )
            ) {
                setRemoveId(null)
            }
        },
        onError: (error) => feedback.onError(error),
    })

    const reorderMutation = useMutation({
        mutationFn: (screenshotIds: Array<string>) =>
            reorderStoreScreenshotsHandler({ data: { appId, screenshotIds } }),
        onSuccess: (result) =>
            feedback.handleResult(result, 'appStore.screenshots.reordered'),
        onError: (error) => feedback.onError(error),
    })

    function handleMove(index: number, offset: -1 | 1) {
        const target = index + offset
        if (target < 0 || target >= screenshots.length) return
        const ids = screenshots.map((screenshot) => screenshot.id)
        const moved = ids[index]
        const swapped = ids[target]
        if (!moved || !swapped) return
        ids[index] = swapped
        ids[target] = moved
        reorderMutation.mutate(ids)
    }

    return {
        state: {
            imageSrc,
            crop: selection.state.crop,
            zoom: selection.state.zoom,
            canAdd: screenshots.length < APP_STORE_CONFIG.maxScreenshots,
            isSavingScreenshot: addMutation.isPending,
            isReordering: reorderMutation.isPending,
            removeId,
            isRemovingScreenshot: removeMutation.isPending,
        },
        handler: {
            handleSelectImage: selection.handler.handleSelectImage,
            handleCropComplete: selection.handler.handleCropComplete,
            handleCropChange: selection.setter.setCrop,
            handleZoomChange: selection.setter.setZoom,
            handleCancelScreenshot: selection.handler.handleResetSelection,
            handleSaveScreenshot: () => addMutation.mutate(),
            handleMove,
            handleOpenRemove: setRemoveId,
            handleCloseRemove: () => setRemoveId(null),
            handleConfirmRemove: () => {
                if (removeId) removeMutation.mutate(removeId)
            },
        },
    }
}
