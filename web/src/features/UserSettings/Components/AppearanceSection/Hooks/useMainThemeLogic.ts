import type { MainThemeLogicReturn } from '../Types/appearance-logic.types.ts'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { DEFAULT_THEME_MODE } from '@/config/user-theme-colors.config.ts'
import type { UserThemeMode } from '@/lib/Theme/Types/userTheme.types.ts'
import { isUserThemeMode } from '@/lib/Theme/userThemeMode.ts'
import useThemeModeMutation from '@/features/UserSettings/Hooks/useThemeModeMutation.ts'

export default function useMainThemeLogic(): MainThemeLogicReturn {
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())
    const themeMutation = useThemeModeMutation()

    const currentThemeMode = isUserThemeMode(sessionData?.user?.themeMode)
        ? sessionData.user.themeMode
        : DEFAULT_THEME_MODE

    const [selectedThemeMode, setSelectedThemeMode] =
        useState<UserThemeMode>(currentThemeMode)
    const [previousThemeMode, setPreviousThemeMode] =
        useState<UserThemeMode>(currentThemeMode)

    if (currentThemeMode !== previousThemeMode) {
        setPreviousThemeMode(currentThemeMode)
        setSelectedThemeMode(currentThemeMode)
    }

    const handleThemeModeChange: (themeMode: UserThemeMode) => void =
        setSelectedThemeMode

    function handleSaveThemeMode() {
        themeMutation.handler.saveThemeMode(selectedThemeMode)
    }

    return {
        state: {
            themeMode: currentThemeMode,
            selectedThemeMode,
            isSavingThemeMode: themeMutation.state.isSavingThemeMode,
        },
        handler: {
            handleThemeModeChange,
            handleSaveThemeMode,
        },
    }
}
