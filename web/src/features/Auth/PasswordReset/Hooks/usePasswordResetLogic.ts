import type { PasswordResetLogicReturn } from '../Types/password-reset-logic.types.ts'
import type { SubmitEvent } from 'react'
import { scheduleCancelableTimeout } from '@/lib/Browser/scheduleCancelableTimeout.ts'
import { useEffect, useRef, useState } from 'react'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import type { PasswordResetFormValues } from '../Types/password-reset-form.types.ts'
import type {
    PasswordResetClientPhase,
    PasswordResetController,
} from '@/lib/Auth/PasswordReset/Types/password-reset-controller.types.ts'
import {
    updatePasswordByTokenHandler,
    validateTokenHandler,
} from '../middleware.ts'
import { PASSWORD_POLICY } from '@/config/security.config.ts'
import { passwordResetConfig } from '@/config/session.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { createPasswordResetController } from '@/lib/Auth/PasswordReset/passwordResetController.ts'
import { getPasswordResetTokenHandoff } from '@/lib/Auth/PasswordReset/passwordResetTokenHandoff.ts'

export default function usePasswordResetLogic(): PasswordResetLogicReturn {
    const navigate = useNavigate()
    const { t } = useTranslationStore()
    const [phase, setPhase] = useState<PasswordResetClientPhase>('checking')
    const controller = useRef<PasswordResetController | null>(null)
    const callbacks = useRef({ navigate, t })
    const form = useForm({
        defaultValues: {
            password: '',
            confirmPassword: '',
        } satisfies PasswordResetFormValues,
        onSubmit: async ({ value }) => {
            await controller.current?.submit(value)
        },
    })

    useEffect(
        function () {
            callbacks.current = { navigate, t }
        },
        [navigate, t],
    )

    useEffect(
        function () {
            if (typeof window === 'undefined') return undefined
            const lifecycle = { disposed: false, scheduled: false }
            const handoff = getPasswordResetTokenHandoff(window)
            const current = createPasswordResetController({
                validate: (token, signal) =>
                    validateTokenHandler({ data: { token }, signal }),
                update: (data, signal) =>
                    updatePasswordByTokenHandler({ data, signal }),
                onPhaseChange: setPhase,
                clearInputs: () => form.reset(),
                onError(reason) {
                    const translate = callbacks.current.t
                    const message =
                        reason === 'password-policy'
                            ? translate('auth.passwordPolicy', {
                                  min: PASSWORD_POLICY.minimumNewLength,
                                  max: PASSWORD_POLICY.maximumLength,
                              })
                            : translate(
                                  reason === 'password-mismatch'
                                      ? 'auth.passwordReset.passwordMismatch'
                                      : reason === 'validation-unavailable'
                                        ? 'auth.passwordReset.validationError'
                                        : 'auth.passwordReset.updateError',
                              )
                    toastAppError(new AppError(message))
                },
                onRejected(reason) {
                    void callbacks.current
                        .navigate({
                            to: '/login',
                            hash:
                                reason === 'missing'
                                    ? 'password-reset-token-missing'
                                    : 'password-reset-token-invalid',
                            replace: true,
                        })
                        .catch(function () {})
                },
                onSuccess() {
                    const translate = callbacks.current.t
                    toast.success(translate('auth.passwordReset.updated'), {
                        title: translate('auth.passwordReset.updatedTitle'),
                    })
                    void callbacks.current
                        .navigate({ to: '/login', replace: true })
                        .catch(function () {})
                },
                requestTimeoutMs: passwordResetConfig.requestTimeoutMs,
                schedule: scheduleCancelableTimeout,
            })
            controller.current = current
            function receive() {
                current.invalidate()
                if (lifecycle.scheduled) return
                lifecycle.scheduled = true
                queueMicrotask(function () {
                    lifecycle.scheduled = false
                    if (lifecycle.disposed) return
                    current.receiveToken(
                        handoff?.take() ?? { status: 'missing' },
                    )
                })
            }
            const unsubscribe = handoff?.subscribe(receive)
            receive()
            return function () {
                lifecycle.disposed = true
                unsubscribe?.()
                current.dispose()
                if (controller.current === current) controller.current = null
            }
        },
        [form],
    )

    function handleRetryValidation() {
        controller.current?.retryValidation()
    }

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit().catch(toastAppError)
    }

    return {
        form,
        state: { phase, isLoading: phase === 'submitting' },
        handler: {
            handleSubmit,
            handleRetryValidation,
        },
    }
}
