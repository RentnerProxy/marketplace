import type { ProfileImageSettingsLogicReturn } from '../Types/account-logic.types.ts'
import useImageCropSelection from '@/shared/Images/Hooks/useImageCropSelection.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getDataUrlByteSize } from '@/lib/Images/imageDataUrlSize.ts'
import { startTransferTask } from '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts'

import { updateCurrentUserProfileImageHandler } from '../../../middleware.ts'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import type { ImageCropPosition } from '@/shared/Types/image-crop.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { profileImageVersionQueryKey } from '@/lib/Queries/appQueries.ts'

export default function useProfileImageSettingsLogic(
    userId: string,
): ProfileImageSettingsLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const selection = useImageCropSelection()
    const { imageSrc, crop, zoom, croppedAreaPixels } = selection.state
    const { setCrop, setZoom } = selection.setter
    const {
        handleSelectImage,
        handleCropComplete,
        handleResetSelection: handleResetSelectedImage,
    } = selection.handler
    const [copy, setCopy] = useState(false)

    const saveProfileImageMutation = useMutation({
        mutationFn: async function () {
            if (!imageSrc || !croppedAreaPixels) {
                return {
                    success: false,
                    error: t('userSettings.profileImage.empty'),
                }
            }

            const transfer = startTransferTask({
                direction: 'upload',
                title: t('userSettings.profileImage.title'),
                totalBytes: getDataUrlByteSize(imageSrc),
            })

            try {
                const result = await updateCurrentUserProfileImageHandler({
                    data: {
                        imageDataUrl: imageSrc,
                        crop: croppedAreaPixels,
                    },
                })

                if (result.success) {
                    transfer.complete(t('toast.profileImageSaved'))
                } else {
                    transfer.fail(result.error)
                }

                return result
            } catch (error) {
                transfer.fail(t('toast.profileImageUploadFailed'))
                throw error
            }
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.profileImageSaved'), {
                title: t('userSettings.header.title'),
            })
            selection.handler.handleClearSelectedImage()
            const nextProfileImageVersion =
                'profileImageVersion' in result
                    ? result.profileImageVersion
                    : Date.now()

            queryClient.setQueryData(
                profileImageVersionQueryKey(userId),
                nextProfileImageVersion,
            )
            updateAuthenticatedSessionUserCache(queryClient, {
                profileImageVersion: nextProfileImageVersion,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const handleCropChange: (nextCrop: ImageCropPosition) => void = setCrop

    const handleZoomChange: (nextZoom: number) => void = setZoom

    function handleSaveProfileImage() {
        saveProfileImageMutation.mutate()
    }

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(userId)
            setCopy(true)
            setTimeout(() => setCopy(false), 2000)
        } catch {
            toastAppError(new AppError(t('userSettings.security.copyFailed')))
        }
    }

    return {
        state: {
            copy,
            crop,
            imageSrc,
            isSavingProfileImage: saveProfileImageMutation.isPending,
            zoom,
        },
        handler: {
            handleCopy,
            handleCropChange,
            handleCropComplete,
            handleResetSelectedImage,
            handleSaveProfileImage,
            handleSelectImage,
            handleZoomChange,
        },
    }
}
