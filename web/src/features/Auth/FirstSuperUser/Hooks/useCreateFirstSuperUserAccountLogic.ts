import { scheduleCancelableTimeout } from '@/lib/Browser/scheduleCancelableTimeout.ts'
import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from '@rentnerkev/toasts'
import { createFirstSuperUserAccountHandler } from '../middleware.ts'
import {
    FIRST_SUPERUSER_SETUP_REQUEST_TIMEOUT_MS,
    PASSWORD_POLICY,
} from '@/config/security.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type {
    CreateFirstSuperUserAccountLogicReturn,
    FirstSuperUserFormField,
    FirstSuperUserFormValues,
} from '../Types/first-super-user-form.types.ts'
import type {
    FirstSetupClientPhase,
    FirstSetupController,
} from '@/lib/Auth/FirstSuperUser/Types/first-setup-controller.types.ts'
import { createFirstSetupController } from '@/lib/Auth/FirstSuperUser/firstSetupController.ts'
import { getFirstSetupTokenHandoff } from '@/lib/Auth/FirstSuperUser/firstSetupTokenHandoff.ts'

const emptyFormValues: FirstSuperUserFormValues = {
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
}

export default function useCreateFirstSuperUserAccountLogic(): CreateFirstSuperUserAccountLogicReturn {
    const navigate = useNavigate()
    const { t } = useTranslationStore()
    const [formValues, setFormValues] =
        useState<FirstSuperUserFormValues>(emptyFormValues)
    const [phase, setPhase] = useState<FirstSetupClientPhase>('checking')
    const controller = useRef<FirstSetupController | null>(null)
    const callbacks = useRef({ navigate, t })

    useEffect(
        function () {
            callbacks.current = { navigate, t }
        },
        [navigate, t],
    )

    useEffect(function () {
        if (typeof window === 'undefined') return undefined
        const lifecycle = { disposed: false, scheduled: false }
        const handoff = getFirstSetupTokenHandoff(window)
        const current = createFirstSetupController({
            create: (data, signal) =>
                createFirstSuperUserAccountHandler({ data, signal }),
            onPhaseChange: setPhase,
            clearPasswords() {
                setFormValues((values) => ({
                    ...values,
                    password: '',
                    confirmPassword: '',
                }))
            },
            onInvalidInput(reason) {
                const translate = callbacks.current.t
                const message =
                    reason === 'password-policy'
                        ? translate('auth.passwordPolicy', {
                              min: PASSWORD_POLICY.minimumNewLength,
                              max: PASSWORD_POLICY.maximumLength,
                          })
                        : translate(
                              reason === 'password-mismatch'
                                  ? 'auth.firstSetup.passwordMismatch'
                                  : reason === 'email'
                                    ? 'auth.firstSetup.invalidEmail'
                                    : reason === 'username'
                                      ? 'auth.firstSetup.invalidUsername'
                                      : 'auth.firstSetup.invalidData',
                          )
                toast.error(message, { title: translate('common.error') })
            },
            onInvalidToken() {
                const translate = callbacks.current.t
                toast.error(translate('auth.firstSetup.invalidSetupToken'), {
                    title: translate('common.error'),
                })
            },
            onError(error) {
                const translate = callbacks.current.t
                toast.error(
                    error instanceof Error && error.message
                        ? error.message
                        : translate('auth.firstSetup.createError'),
                    { title: translate('common.error') },
                )
            },
            onComplete(outcome) {
                const translate = callbacks.current.t
                if (outcome === 'created') {
                    toast.success(translate('auth.firstSetup.created'), {
                        title: translate('auth.firstSetup.title'),
                    })
                } else {
                    toast.error(translate('auth.firstSetup.alreadyCompleted'), {
                        title: translate('common.error'),
                    })
                }
                void callbacks.current
                    .navigate({ to: '/login' })
                    .catch(function () {})
            },
            requestTimeoutMs: FIRST_SUPERUSER_SETUP_REQUEST_TIMEOUT_MS,
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
                current.receiveToken(handoff?.take() ?? { status: 'missing' })
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
    }, [])

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        event.stopPropagation()
        void controller.current?.submit(formValues)
    }

    function setFieldValue(field: FirstSuperUserFormField, value: string) {
        setFormValues((current) => ({
            ...current,
            [field]: value,
        }))
    }

    return {
        state: {
            formValues,
            isCreating: phase === 'submitting',
            setupAccessState:
                phase === 'checking'
                    ? 'checking'
                    : phase === 'granted' || phase === 'submitting'
                      ? 'granted'
                      : 'missing',
        },
        handler: {
            handleSubmit,
        },
        setter: {
            setFieldValue,
        },
    }
}
