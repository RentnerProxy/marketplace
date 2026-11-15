import type { CustomBackgroundImageMutationsOptions } from '../Types/custom-background-logic.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getDataUrlByteSize } from '@/lib/Images/imageDataUrlSize.ts'
import { startTransferTask } from '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts'
import {
    deleteCurrentUserBackgroundHandler,
    updateCurrentUserBackgroundHandler,
} from '@/features/UserSettings/middleware.ts'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function useCustomBackgroundImageMutations({
    backgroundCroppedAreaPixels,
    backgroundImageSrc,
    customBackgroundDarknessValue,
    resetSelectedBackgroundImage,
}: CustomBackgroundImageMutationsOptions) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()

    const saveBackgroundImageMutation = useMutation({
        mutationFn: async function () {
            if (!backgroundImageSrc || !backgroundCroppedAreaPixels) {
                return {
                    success: false as const,
                    error: t('toast.backgroundMissing'),
                }
            }

            const transfer = startTransferTask({
                direction: 'upload',
                title: t('userSettings.background.custom'),
                totalBytes: getDataUrlByteSize(backgroundImageSrc),
            })

            try {
                const result = await updateCurrentUserBackgroundHandler({
                    data: {
                        imageDataUrl: backgroundImageSrc,
                        crop: backgroundCroppedAreaPixels,
                        customBackgroundDarkness: customBackgroundDarknessValue,
                    },
                })

                if (result.success) {
                    transfer.complete(t('toast.backgroundSaved'))
                } else {
                    transfer.fail(result.error)
                }

                return result
            } catch (error) {
                transfer.fail(t('toast.backgroundUploadFailed'))
                throw error
            }
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            resetSelectedBackgroundImage()

            toast.success(t('toast.backgroundSaved'), {
                title: t('userSettings.header.title'),
            })

            const nextCustomBackgroundUpdatedAt =
                'customBackgroundUpdatedAt' in result
                    ? result.customBackgroundUpdatedAt
                    : new Date().toISOString()

            updateAuthenticatedSessionUserCache(queryClient, {
                customBackgroundDarkness:
                    result.customBackgroundDarkness ??
                    customBackgroundDarknessValue,
                customBackgroundUpdatedAt: nextCustomBackgroundUpdatedAt,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const deleteBackgroundImageMutation = useMutation({
        mutationFn: async function () {
            return await deleteCurrentUserBackgroundHandler()
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            resetSelectedBackgroundImage()

            toast.success(t('toast.backgroundDeleted'), {
                title: t('userSettings.header.title'),
            })

            updateAuthenticatedSessionUserCache(queryClient, {
                customBackgroundDarkness: null,
                customBackgroundUpdatedAt: null,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    function handleDeleteBackgroundImage() {
        deleteBackgroundImageMutation.mutate()
    }

    function handleSaveBackgroundImage() {
        saveBackgroundImageMutation.mutate()
    }

    return {
        handler: {
            handleDeleteBackgroundImage,
            handleSaveBackgroundImage,
        },
        state: {
            isDeletingBackgroundImage: deleteBackgroundImageMutation.isPending,
            isSavingBackgroundImage: saveBackgroundImageMutation.isPending,
        },
    }
}
