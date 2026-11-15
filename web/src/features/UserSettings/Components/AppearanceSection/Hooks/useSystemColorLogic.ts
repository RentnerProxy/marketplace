import type { SystemColorLogicReturn } from '../Types/appearance-logic.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { normalizeColor } from '@rentnerkev/picker'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
    DEFAULT_PRIMARY_COLOR,
    USER_PRIMARY_COLOR_PRESETS,
} from '@/config/user-theme-colors.config.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import {
    getPrimaryColorForeground,
    getPrimaryColorHover,
} from '@/lib/Theme/primaryColor.ts'
import {
    resetCurrentUserPrimaryColorHandler,
    updateCurrentUserPrimaryColorHandler,
} from '@/features/UserSettings/middleware.ts'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

function getTransparentColor(color: string) {
    const normalizedColor = normalizeColor(color) ?? DEFAULT_PRIMARY_COLOR

    return `${normalizedColor}33`
}

export default function useSystemColorLogic(): SystemColorLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()

    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())

    const currentPrimaryColor =
        sessionData?.user?.primaryColor ?? DEFAULT_PRIMARY_COLOR

    const [selectedPrimaryColor, setSelectedPrimaryColor] =
        useState(currentPrimaryColor)
    const [previousPrimaryColor, setPreviousPrimaryColor] =
        useState(currentPrimaryColor)
    const currentSessionUserId = sessionData?.user?.id
    const [previousSessionUserId, setPreviousSessionUserId] =
        useState(currentSessionUserId)
    const [primaryColorResetKey, setPrimaryColorResetKey] = useState(0)
    const [isPrimaryColorValid, setIsPrimaryColorValid] = useState(true)

    if (
        currentPrimaryColor !== previousPrimaryColor ||
        previousSessionUserId !== currentSessionUserId
    ) {
        setPreviousPrimaryColor(currentPrimaryColor)
        setSelectedPrimaryColor(currentPrimaryColor)
        setPreviousSessionUserId(currentSessionUserId)
        setPrimaryColorResetKey((key) => key + 1)
        setIsPrimaryColorValid(true)
    }

    const selectedPrimaryColorHover = useMemo(() => {
        return getPrimaryColorHover(
            normalizeColor(selectedPrimaryColor) ?? DEFAULT_PRIMARY_COLOR,
        )
    }, [selectedPrimaryColor])

    const selectedPrimaryColorTransparent = useMemo(() => {
        return getTransparentColor(selectedPrimaryColor)
    }, [selectedPrimaryColor])

    const selectedPrimaryColorForeground = useMemo(() => {
        return getPrimaryColorForeground(
            normalizeColor(selectedPrimaryColor) ?? DEFAULT_PRIMARY_COLOR,
        )
    }, [selectedPrimaryColor])

    const savePrimaryColorMutation = useMutation({
        mutationFn: async function () {
            const normalizedPrimaryColor = normalizeColor(selectedPrimaryColor)

            if (!normalizedPrimaryColor) {
                throw new AppError(t('toast.primaryColorInvalid'))
            }

            return await updateCurrentUserPrimaryColorHandler({
                data: {
                    primaryColor: normalizedPrimaryColor,
                },
            })
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.primaryColorSaved'), {
                title: t('userSettings.header.title'),
            })

            updateAuthenticatedSessionUserCache(queryClient, {
                primaryColor: result.primaryColor,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const resetPrimaryColorMutation = useMutation({
        mutationFn: async function () {
            return await resetCurrentUserPrimaryColorHandler()
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            setSelectedPrimaryColor(result.primaryColor)
            setPrimaryColorResetKey((key) => key + 1)
            setIsPrimaryColorValid(true)

            toast.success(t('toast.primaryColorReset'), {
                title: t('userSettings.header.title'),
            })

            updateAuthenticatedSessionUserCache(queryClient, {
                primaryColor: null,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const handlePrimaryColorChange: (nextColor: string) => void =
        setSelectedPrimaryColor

    const handlePrimaryColorValidityChange: (isValid: boolean) => void =
        setIsPrimaryColorValid

    function handleResetPrimaryColor() {
        resetPrimaryColorMutation.mutate()
    }

    function handleSavePrimaryColor() {
        if (!isPrimaryColorValid) {
            return
        }

        savePrimaryColorMutation.mutate()
    }

    return {
        state: {
            colorPresets: [...USER_PRIMARY_COLOR_PRESETS],
            primaryColorResetKey,
            selectedPrimaryColor,
            isPrimaryColorValid,
            selectedPrimaryColorForeground,
            selectedPrimaryColorHover,
            selectedPrimaryColorTransparent,
            isSavingPrimaryColor:
                savePrimaryColorMutation.isPending ||
                resetPrimaryColorMutation.isPending,
        },
        handler: {
            handlePrimaryColorChange,
            handlePrimaryColorValidityChange,
            handleResetPrimaryColor,
            handleSavePrimaryColor,
        },
    }
}
