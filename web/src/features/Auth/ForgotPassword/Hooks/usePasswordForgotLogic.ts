import type { PasswordForgotLogicReturn } from '../Types/forgot-password-logic.types.ts'
import type { SubmitEvent } from 'react'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useForm } from '@tanstack/react-form'
import type { RequestPasswordResetInput } from '@/features/Auth/ForgotPassword/Types/forgot-password-server-input.types.ts'
import { useMutation } from '@tanstack/react-query'
import { requestPasswordResetHandler } from '@/features/Auth/ForgotPassword/middleware.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function usePasswordForgotLogic(): PasswordForgotLogicReturn {
    const { t } = useTranslationStore()
    const form = useForm({
        defaultValues: {
            email: '',
        } satisfies RequestPasswordResetInput,
        onSubmit: async ({ value }) => {
            resetMutation(value)
        },
    })

    const { mutate: resetMutation, isPending: isLoading } = useMutation({
        mutationFn: async function (formData: RequestPasswordResetInput) {
            return await requestPasswordResetHandler({
                data: formData,
            })
        },
        onSuccess: function () {
            toast.success(t('auth.forgotPassword.emailSent'), {
                title: t('auth.forgotPassword.title'),
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit().catch(toastAppError)
    }

    return {
        form,
        handler: { handleSubmit },
        state: {
            isLoading,
        },
    }
}
