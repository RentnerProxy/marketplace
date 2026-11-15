import type { FontsLogicReturn } from '../Types/appearance-logic.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { DEFAULT_FONT_FAMILY } from '@/config/user-theme-colors.config.ts'
import type { UserFontFamily } from '@/lib/Theme/Types/userTheme.types.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { isUserFontFamily } from '@/lib/Theme/userFontSettings.ts'
import { updateCurrentUserFontFamilyHandler } from '@/features/UserSettings/middleware.ts'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function useFontsLogic(): FontsLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()

    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())

    const currentFontFamily = isUserFontFamily(sessionData?.user?.fontFamily)
        ? sessionData.user.fontFamily
        : DEFAULT_FONT_FAMILY

    const [selectedFontFamily, setSelectedFontFamily] =
        useState<UserFontFamily>(currentFontFamily)
    const [previousFontFamily, setPreviousFontFamily] =
        useState<UserFontFamily>(currentFontFamily)

    if (currentFontFamily !== previousFontFamily) {
        setPreviousFontFamily(currentFontFamily)
        setSelectedFontFamily(currentFontFamily)
    }

    const saveFontFamilyMutation = useMutation({
        mutationFn: async function () {
            return await updateCurrentUserFontFamilyHandler({
                data: {
                    fontFamily: selectedFontFamily,
                },
            })
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.fontFamilySaved'), {
                title: t('userSettings.header.title'),
            })

            updateAuthenticatedSessionUserCache(queryClient, {
                fontFamily: result.fontFamily,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const handleFontFamilyChange: (nextFontFamily: UserFontFamily) => void =
        setSelectedFontFamily

    function handleSaveFontFamily() {
        saveFontFamilyMutation.mutate()
    }

    return {
        state: {
            selectedFontFamily,
            isSavingFontFamily: saveFontFamilyMutation.isPending,
        },
        handler: {
            handleSaveFontFamily,
            handleFontFamilyChange,
        },
    }
}
