import type { PasswordResetLogicReturn } from '../Types/security-logic.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation } from '@tanstack/react-query'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { requestCurrentUserPasswordResetHandler } from '@/features/UserSettings/middleware.ts'

export default function usePasswordResetLogic(): PasswordResetLogicReturn {
    const { t } = useTranslationStore()

    const requestPasswordResetMutation = useMutation({
        mutationFn: async function () {
            return await requestCurrentUserPasswordResetHandler()
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.passwordResetSent'), {
                title: t('userSettings.header.title'),
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    function handleRequestPasswordReset() {
        requestPasswordResetMutation.mutate()
    }

    return {
        state: {
            isRequestingPasswordReset: requestPasswordResetMutation.isPending,
        },
        handler: {
            handleRequestPasswordReset,
        },
    }
}
