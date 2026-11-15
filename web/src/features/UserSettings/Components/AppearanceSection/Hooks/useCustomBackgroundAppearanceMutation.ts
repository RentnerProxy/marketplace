import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { updateCurrentUserBackgroundAppearanceHandler } from '@/features/UserSettings/middleware.ts'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function useCustomBackgroundAppearanceMutation(
    customBackgroundDarkness: number,
) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [customBackgroundDarknessValue, setCustomBackgroundDarknessValue] =
        useState(customBackgroundDarkness)
    const [
        previousCustomBackgroundDarkness,
        setPreviousCustomBackgroundDarkness,
    ] = useState(customBackgroundDarkness)

    if (customBackgroundDarkness !== previousCustomBackgroundDarkness) {
        setPreviousCustomBackgroundDarkness(customBackgroundDarkness)
        setCustomBackgroundDarknessValue(customBackgroundDarkness)
    }

    const saveBackgroundAppearanceMutation = useMutation({
        mutationFn: async function () {
            return await updateCurrentUserBackgroundAppearanceHandler({
                data: {
                    customBackgroundDarkness: customBackgroundDarknessValue,
                },
            })
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.appearanceSaved'), {
                title: t('userSettings.header.title'),
            })

            updateAuthenticatedSessionUserCache(queryClient, {
                customBackgroundDarkness: result.customBackgroundDarkness,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const handleBackgroundDarknessChange: (nextDarkness: number) => void =
        setCustomBackgroundDarknessValue

    function handleSaveBackgroundAppearance() {
        saveBackgroundAppearanceMutation.mutate()
    }

    return {
        handler: {
            handleBackgroundDarknessChange,
            handleSaveBackgroundAppearance,
        },
        state: {
            customBackgroundDarknessValue,
            isSavingBackgroundAppearance:
                saveBackgroundAppearanceMutation.isPending,
        },
    }
}
