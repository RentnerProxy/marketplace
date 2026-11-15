import type { FontSizeLogicReturn } from '../Types/appearance-logic.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_SIZE,
} from '@/config/user-theme-colors.config.ts'
import type {
    UserFontFamily,
    UserFontSize,
} from '@/lib/Theme/Types/userTheme.types.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import {
    isUserFontFamily,
    isUserFontSize,
} from '@/lib/Theme/userFontSettings.ts'
import { updateCurrentUserFontSizeHandler } from '@/features/UserSettings/middleware.ts'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function useFontSizeLogic(): FontSizeLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()

    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())

    const currentFontSize = isUserFontSize(sessionData?.user?.fontSize)
        ? sessionData.user.fontSize
        : DEFAULT_FONT_SIZE

    const selectedFontFamily: UserFontFamily = isUserFontFamily(
        sessionData?.user?.fontFamily,
    )
        ? sessionData.user.fontFamily
        : DEFAULT_FONT_FAMILY

    const [selectedFontSize, setSelectedFontSize] =
        useState<UserFontSize>(currentFontSize)
    const [previousFontSize, setPreviousFontSize] =
        useState<UserFontSize>(currentFontSize)

    if (currentFontSize !== previousFontSize) {
        setPreviousFontSize(currentFontSize)
        setSelectedFontSize(currentFontSize)
    }

    const saveFontSizeMutation = useMutation({
        mutationFn: async function () {
            return await updateCurrentUserFontSizeHandler({
                data: {
                    fontSize: selectedFontSize,
                },
            })
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.fontSizeSaved'), {
                title: t('userSettings.header.title'),
            })

            updateAuthenticatedSessionUserCache(queryClient, {
                fontSize: result.fontSize,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    function handleFontSizeChange(nextFontSize: number) {
        if (isUserFontSize(nextFontSize)) {
            setSelectedFontSize(nextFontSize)
        }
    }

    function handleSaveFontSize() {
        saveFontSizeMutation.mutate()
    }

    return {
        state: {
            selectedFontSize,
            isSavingFontSize: saveFontSizeMutation.isPending,
            selectedFontFamily,
        },
        handler: {
            handleFontSizeChange,
            handleSaveFontSize,
        },
    }
}
