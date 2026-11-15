import type { MainThemeLogicReturn } from '../Types/appearance-logic.types.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { DEFAULT_THEME_MODE } from '@/config/user-theme-colors.config.ts'
import type { UserThemeMode } from '@/lib/Theme/Types/userTheme.types.ts'
import { isUserThemeMode } from '@/lib/Theme/userThemeMode.ts'
import { updateCurrentUserThemeModeHandler } from '@/features/UserSettings/middleware.ts'
import { toast } from '@rentnerkev/toasts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function useMainThemeLogic(): MainThemeLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())

    const currentThemeMode = isUserThemeMode(sessionData?.user?.themeMode)
        ? sessionData.user.themeMode
        : DEFAULT_THEME_MODE

    const [selectedThemeMode, setSelectedThemeMode] =
        useState<UserThemeMode>(currentThemeMode)
    const [previousThemeMode, setPreviousThemeMode] =
        useState<UserThemeMode>(currentThemeMode)

    const { mutate: saveThemeMode, isPending: isSavingThemeMode } = useMutation(
        {
            mutationFn: updateCurrentUserThemeModeHandler,
            onSuccess: async function (result) {
                if (!result.success) {
                    toastAppError(new AppError(result.error))
                    return
                }
                await queryClient.invalidateQueries({
                    queryKey: authenticatedSessionQueryOptions().queryKey,
                })
                toast.success(t('userSettings.theme.saved'), {
                    title: t('userSettings.theme.title'),
                })
            },
            onError(error: unknown) {
                toastAppError(error)
            },
        },
    )

    if (currentThemeMode !== previousThemeMode) {
        setPreviousThemeMode(currentThemeMode)
        setSelectedThemeMode(currentThemeMode)
    }

    const handleThemeModeChange: (themeMode: UserThemeMode) => void =
        setSelectedThemeMode

    function handleSaveThemeMode() {
        saveThemeMode({
            data: {
                themeMode: selectedThemeMode,
            },
        })
    }

    return {
        state: {
            themeMode: currentThemeMode,
            selectedThemeMode,
            isSavingThemeMode,
        },
        handler: {
            handleThemeModeChange,
            handleSaveThemeMode,
        },
    }
}
