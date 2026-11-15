import type { MaintenanceBannerLogicReturn } from '../Types/authenticated-layout-logic.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import useTranslationStore from '@/language/useTranslationStore.ts'
import { requestMaintenanceExtensionHandler } from '@/features/Maintenance/middleware.ts'
import { SYSTEM_SETTINGS_QUERY_KEY } from '@/lib/Queries/appQueries.ts'

export default function useMaintenanceBannerLogic(): MaintenanceBannerLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [reason, setReason] = useState('')

    const {
        mutate: requestMaintenanceExtensionMutation,
        isPending: isRequestingMaintenanceExtension,
    } = useMutation({
        mutationFn: async function (requestReason: string) {
            return await requestMaintenanceExtensionHandler({
                data: { reason: requestReason },
            })
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.maintenanceRequestSent'), {
                title: t('admin.systemSettings.maintenance'),
            })
            setReason('')
            await queryClient.invalidateQueries({
                queryKey: SYSTEM_SETTINGS_QUERY_KEY,
            })
        },
        onError: function (error) {
            toastAppError(
                new AppError(
                    error instanceof Error && error.message
                        ? error.message
                        : t('toast.maintenanceRequestFailed'),
                ),
            )
        },
    })

    function handleRequestMaintenanceExtension() {
        const trimmedReason = reason.trim()

        if (trimmedReason.length < 10) {
            toastAppError(new AppError(t('toast.maintenanceInvalidReason')))
            return
        }

        requestMaintenanceExtensionMutation(trimmedReason)
    }

    const handleReasonChange: (value: string) => void = setReason

    return {
        state: {
            isRequestingMaintenanceExtension,
            reason,
        },
        handler: {
            handleReasonChange,
            handleRequestMaintenanceExtension,
        },
    }
}
