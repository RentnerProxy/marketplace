import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { ADMIN_SYSTEM_SETTINGS_QUERY_KEY } from '@/lib/Queries/appQueries.ts'
import { updateCompanyNameHandler } from '../middleware.ts'

export default function useCompanyNameForm(
    currentCompanyName: string | undefined,
) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [companyName, setCompanyName] = useState(currentCompanyName ?? '')
    const [previousCompanyName, setPreviousCompanyName] =
        useState(currentCompanyName)

    if (currentCompanyName !== previousCompanyName) {
        setPreviousCompanyName(currentCompanyName)

        if (currentCompanyName) {
            setCompanyName(currentCompanyName)
        }
    }

    const { mutate: saveCompanyNameMutation, isPending: isSavingCompanyName } =
        useMutation({
            mutationFn: async function () {
                return await updateCompanyNameHandler({ data: { companyName } })
            },
            onSuccess: async function (result) {
                if (!result.success) {
                    toastAppError(new AppError(result.error))
                    return
                }

                toast.success(t('admin.systemSettings.companyNameSaved'), {
                    title: t('admin.systemSettings.toastTitle'),
                })
                await queryClient.invalidateQueries({
                    queryKey: ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
                })
            },
            onError: function (error) {
                toast.error(
                    error instanceof Error && error.message
                        ? error.message
                        : t('admin.systemSettings.companyNameSaveError'),
                    { title: t('common.error') },
                )
            },
        })

    const handleCompanyNameChange: (value: string) => void = setCompanyName

    function handleSaveCompanyName() {
        saveCompanyNameMutation()
    }

    return {
        state: {
            companyName,
            isSavingCompanyName,
        },
        handler: {
            handleCompanyNameChange,
            handleSaveCompanyName,
        },
    }
}
