import type { UseMaintenanceSettingsParams } from '../Types/system-settings-logic.types.ts'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SerializedSingleCalendarValue } from '@rentnerkev/calendar'
import { toast } from '@rentnerkev/toasts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { ADMIN_SYSTEM_SETTINGS_QUERY_KEY } from '@/lib/Queries/appQueries.ts'
import {
    resolveMaintenanceExtensionRequestHandler,
    updateMaintenanceModeHandler,
} from '../middleware.ts'

export default function useMaintenanceSettings({
    currentMaintenanceStartsAt,
    pendingMaintenanceExtensionRequest,
}: UseMaintenanceSettingsParams) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [maintenanceMinDateTime] = useState(() => new Date())
    const [previousMaintenanceStartsAt, setPreviousMaintenanceStartsAt] =
        useState(currentMaintenanceStartsAt)
    const [maintenanceStartsAt, setMaintenanceStartsAt] =
        useState<SerializedSingleCalendarValue>(() =>
            getMaintenanceStart(currentMaintenanceStartsAt),
        )
    const [maintenanceExtensionMinutes, setMaintenanceExtensionMinutes] =
        useState<number | null>(10)

    if (currentMaintenanceStartsAt !== previousMaintenanceStartsAt) {
        setPreviousMaintenanceStartsAt(currentMaintenanceStartsAt)
        setMaintenanceStartsAt(getMaintenanceStart(currentMaintenanceStartsAt))
    }

    const isMaintenanceExtensionMinutesValid =
        maintenanceExtensionMinutes !== null &&
        Number.isInteger(maintenanceExtensionMinutes) &&
        maintenanceExtensionMinutes >= 1 &&
        maintenanceExtensionMinutes <= 120
    const maintenanceExtensionMinutesError = isMaintenanceExtensionMinutesValid
        ? null
        : t('admin.systemSettings.extensionMinutesInvalid')

    const {
        mutate: saveMaintenanceModeMutation,
        isPending: isSavingMaintenanceMode,
    } = useMutation({
        mutationFn: async function (isEnabled: boolean) {
            if (isEnabled) {
                if (!maintenanceStartsAt) {
                    return {
                        success: false,
                        error: t(
                            'admin.systemSettings.maintenanceStartRequired',
                        ),
                    }
                }

                return await updateMaintenanceModeHandler({
                    data: {
                        isEnabled,
                        startsAt: maintenanceStartsAt,
                    },
                })
            }

            return await updateMaintenanceModeHandler({
                data: { isEnabled },
            })
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(
                'isMaintenanceModeEnabled' in result &&
                    result.isMaintenanceModeEnabled
                    ? t('admin.systemSettings.maintenancePlanned')
                    : t('admin.systemSettings.maintenanceDisabled'),
                { title: t('admin.systemSettings.toastTitle') },
            )
            await queryClient.invalidateQueries({
                queryKey: ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
            })
        },
        onError: function (error) {
            toast.error(
                error instanceof Error && error.message
                    ? error.message
                    : t('admin.systemSettings.maintenanceSaveError'),
                { title: t('common.error') },
            )
        },
    })

    const {
        mutate: resolveMaintenanceExtensionRequestMutation,
        isPending: isResolvingMaintenanceExtensionRequest,
    } = useMutation({
        mutationFn: async function (status: 'approved' | 'rejected') {
            if (!pendingMaintenanceExtensionRequest) {
                return {
                    success: false,
                    error: t('admin.systemSettings.extensionRequestMissing'),
                }
            }

            if (status === 'approved' && !isMaintenanceExtensionMinutesValid) {
                return {
                    success: false,
                    error: t('admin.systemSettings.extensionMinutesInvalid'),
                }
            }

            return await resolveMaintenanceExtensionRequestHandler({
                data: {
                    requestId: pendingMaintenanceExtensionRequest.id,
                    status,
                    extensionMinutes:
                        status === 'approved'
                            ? (maintenanceExtensionMinutes ?? undefined)
                            : undefined,
                },
            })
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('admin.systemSettings.extensionRequestResolved'), {
                title: t('admin.systemSettings.maintenanceToastTitle'),
            })
            await queryClient.invalidateQueries({
                queryKey: ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
            })
        },
        onError: function (error) {
            toast.error(
                error instanceof Error && error.message
                    ? error.message
                    : t('admin.systemSettings.extensionRequestResolveError'),
                { title: t('common.error') },
            )
        },
    })

    const handleMaintenanceStartsAtChange: (
        value: SerializedSingleCalendarValue,
    ) => void = setMaintenanceStartsAt

    const handleMaintenanceExtensionMinutesChange: (
        value: number | null,
    ) => void = setMaintenanceExtensionMinutes

    function handleEnableMaintenanceMode() {
        saveMaintenanceModeMutation(true)
    }

    function handleDisableMaintenanceMode() {
        saveMaintenanceModeMutation(false)
    }

    function handleApproveMaintenanceExtensionRequest() {
        resolveMaintenanceExtensionRequestMutation('approved')
    }

    function handleRejectMaintenanceExtensionRequest() {
        resolveMaintenanceExtensionRequestMutation('rejected')
    }

    return {
        state: {
            maintenanceMinDateTime,
            maintenanceStartsAt,
            maintenanceExtensionMinutes,
            maintenanceExtensionMinutesError,
            isSavingMaintenanceMode,
            isResolvingMaintenanceExtensionRequest,
        },
        handler: {
            handleMaintenanceStartsAtChange,
            handleMaintenanceExtensionMinutesChange,
            handleEnableMaintenanceMode,
            handleDisableMaintenanceMode,
            handleApproveMaintenanceExtensionRequest,
            handleRejectMaintenanceExtensionRequest,
        },
    }
}

function getMaintenanceStart(value: string | null | undefined) {
    return value ?? new Date(Date.now() + 15 * 60 * 1000).toISOString()
}
