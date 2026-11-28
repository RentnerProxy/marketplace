import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '@rentnerkev/toasts'
import {
    deleteCurrentUserBackgroundHandler,
    updateCurrentUserBackgroundHandler,
} from '@/features/UserSettings/middleware.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { getDataUrlByteSize } from '@/lib/Images/imageDataUrlSize.ts'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useImageCropSelection from '@/shared/Images/Hooks/useImageCropSelection.ts'
import { startTransferTask } from '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts'
import type { ImageCropPosition } from '@/shared/Types/image-crop.types.ts'
import type { ProfileBannerLogicReturn } from '../Types/user-profile.types.ts'

/** Uploads, crops and removes the profile banner (stored as the user background). */
export default function useProfileBannerLogic(): ProfileBannerLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const selection = useImageCropSelection()
    const { imageSrc, crop, zoom, croppedAreaPixels } = selection.state
    const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false)

    const saveBannerMutation = useMutation({
        mutationFn: async function () {
            if (!imageSrc || !croppedAreaPixels) {
                return {
                    success: false as const,
                    error: t('toast.backgroundMissing'),
                }
            }

            const transfer = startTransferTask({
                direction: 'upload',
                title: t('profile.banner.save'),
                totalBytes: getDataUrlByteSize(imageSrc),
            })

            try {
                const result = await updateCurrentUserBackgroundHandler({
                    data: { imageDataUrl: imageSrc, crop: croppedAreaPixels },
                })

                if (result.success) {
                    transfer.complete(t('profile.banner.saved'))
                } else {
                    transfer.fail(result.error)
                }

                return result
            } catch (error) {
                transfer.fail(t('profile.banner.failed'))
                throw error
            }
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('profile.banner.saved'), {
                title: t('profile.title'),
            })
            selection.handler.handleClearSelectedImage()
            updateAuthenticatedSessionUserCache(queryClient, {
                customBackgroundDarkness: result.customBackgroundDarkness,
                customBackgroundUpdatedAt: result.customBackgroundUpdatedAt,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const removeBannerMutation = useMutation({
        mutationFn: async function () {
            return await deleteCurrentUserBackgroundHandler()
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('profile.banner.removed'), {
                title: t('profile.title'),
            })
            setIsRemoveDialogOpen(false)
            updateAuthenticatedSessionUserCache(queryClient, {
                customBackgroundDarkness: null,
                customBackgroundUpdatedAt: null,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const handleCropChange: (nextCrop: ImageCropPosition) => void =
        selection.setter.setCrop

    const handleZoomChange: (nextZoom: number) => void =
        selection.setter.setZoom

    function handleSaveBanner() {
        saveBannerMutation.mutate()
    }

    function handleOpenRemoveBanner() {
        setIsRemoveDialogOpen(true)
    }

    function handleCloseRemoveBanner() {
        setIsRemoveDialogOpen(false)
    }

    function handleConfirmRemoveBanner() {
        removeBannerMutation.mutate()
    }

    return {
        state: {
            crop,
            imageSrc,
            isRemoveDialogOpen,
            isRemovingBanner: removeBannerMutation.isPending,
            isSavingBanner: saveBannerMutation.isPending,
            zoom,
        },
        handler: {
            handleCancelBanner: selection.handler.handleClearSelectedImage,
            handleCloseRemoveBanner,
            handleConfirmRemoveBanner,
            handleCropChange,
            handleCropComplete: selection.handler.handleCropComplete,
            handleOpenRemoveBanner,
            handleSaveBanner,
            handleSelectImage: selection.handler.handleSelectImage,
            handleZoomChange,
        },
    }
}
