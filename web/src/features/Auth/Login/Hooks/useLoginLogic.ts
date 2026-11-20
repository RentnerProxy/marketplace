import type { LoginLogicReturn } from '../Types/login-logic.types.ts'
import type { SubmitEvent } from 'react'
import type { LoginRedirectReason } from '@/lib/Routes/Types/route-redirect.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { useForm } from '@tanstack/react-form'
import type {
    LoginFormValues,
    LoginRequestValues,
} from '@/features/Auth/Login/Types/login-form.types.ts'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import {
    beginPasskeyLoginHandler,
    finishPasskeyLoginHandler,
    loginHandler,
} from '@/features/Auth/Login/middleware.ts'
import { useNavigate } from '@tanstack/react-router'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    browserSupportsWebAuthn,
    startAuthentication,
} from '@simplewebauthn/browser'
import useLoginRedirectToast from './useLoginRedirectToast.ts'
import useTwoFactorLogin from './useTwoFactorLogin.ts'
import { consumePermittedRestoreReturnPath } from '@/lib/Restore/restoreReturnPath.ts'
import { clearAuthenticatedQueryCache } from '@/lib/Queries/authenticatedSessionCache.ts'
import { systemSettingsQueryOptions } from '@/lib/Queries/appQueries.ts'

export default function useLoginLogic(
    redirectReason?: LoginRedirectReason,
): LoginLogicReturn {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const settings = useQuery(systemSettingsQueryOptions())
    const { t } = useTranslationStore()
    useLoginRedirectToast(redirectReason)

    const form = useForm({
        defaultValues: {
            username: '',
            password: '',
        } satisfies LoginFormValues,
        onSubmit: async ({ value }) => {
            loginMutation(value)
        },
    })

    async function handleSuccessfulLogin(
        result: Awaited<ReturnType<typeof loginHandler>>,
    ) {
        if (!result.success) {
            return
        }

        clearAuthenticatedQueryCache(queryClient)
        form.setFieldValue('password', '')
        twoFactor.handler.handleBackToLogin()

        toast.success(t('toast.loginSuccess'), { title: t('auth.login.title') })

        if (result.loggedOutDueToMissingPermissions) {
            toast.error(result.error || t('toast.loginMissingPermissions'), {
                title: t('common.error'),
            })
        }

        const restoreReturnPath = consumePermittedRestoreReturnPath({
            currentUserId: result.user.id,
            permissions: result.user.permissions,
        })
        const redirectTarget =
            !result.loggedOutDueToMissingPermissions && restoreReturnPath
                ? restoreReturnPath
                : result.redirectTo

        await navigate({ href: redirectTarget })
    }

    const {
        mutate: loginMutation,
        isPending: isLoading,
        reset: resetLoginMutation,
    } = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async function (formData: LoginRequestValues) {
            const result = await loginHandler({
                data: {
                    username: formData.username,
                    password: formData.password,
                    twoFactorCode: formData.twoFactorCode,
                    trustThisDevice: formData.trustThisDevice,
                },
            })
            if (typeof result?.success !== 'boolean') {
                throw new AppError(t('auth.login.failed'))
            }
            return result
        },
        onSuccess: async function (result) {
            if (result.success) {
                await handleSuccessfulLogin(result)
                return
            }

            if (result.requiresTwoFactor) {
                twoFactor.handler.showTwoFactorForm(Boolean(result.error))
                toast.error(
                    result.error || t('auth.login.twoFactorCodeRequired'),
                    { title: t('common.error') },
                )
                return
            }

            toastAppError(new AppError(result.error || t('auth.login.failed')))
        },
        onError: function (error) {
            toast.error(
                error instanceof Error && error.message
                    ? error.message
                    : t('auth.login.failed'),
                { title: t('common.error') },
            )
        },
        onSettled() {
            resetLoginMutation()
        },
    })

    const twoFactor = useTwoFactorLogin(
        ({ twoFactorCode, trustThisDevice }) => {
            loginMutation({
                username: form.state.values.username,
                password: form.state.values.password,
                twoFactorCode,
                trustThisDevice,
            })
        },
    )

    const {
        mutate: passkeyLoginMutation,
        isPending: isPasskeyLoading,
        reset: resetPasskeyLoginMutation,
    } = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async function () {
            if (!browserSupportsWebAuthn()) {
                throw new AppError(t('auth.login.passkeyUnsupported'))
            }

            const beginResult = await beginPasskeyLoginHandler({
                data: {
                    username: form.state.values.username || undefined,
                },
            })

            const response = await startAuthentication({
                optionsJSON: beginResult.options,
            })

            const result = await finishPasskeyLoginHandler({
                data: {
                    challengeId: beginResult.challengeId,
                    response,
                },
            })
            if (typeof result?.success !== 'boolean') {
                throw new AppError(t('auth.login.passkeyFailed'))
            }
            return result
        },
        onSuccess: async function (result) {
            if (result.success) {
                await handleSuccessfulLogin(result)
                return
            }

            toastAppError(
                new AppError(result.error || t('auth.login.passkeyFailed')),
            )
        },
        onError: function (error) {
            toastAppError(error)
        },
        onSettled() {
            resetPasskeyLoginMutation()
        },
    })

    function handlePasskeyLogin() {
        passkeyLoginMutation()
    }

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit().catch(toastAppError)
    }

    return {
        form,
        state: {
            isLoading,
            isPasskeyLoading,
            isPublicRegistrationEnabled:
                settings.data?.isPublicRegistrationEnabled === true,
            requiresTwoFactor: twoFactor.state.requiresTwoFactor,
            twoFactorCode: twoFactor.state.twoFactorCode,
            trustThisDevice: twoFactor.state.trustThisDevice,
            isTwoFactorError: twoFactor.state.isTwoFactorError,
        },
        setter: {
            setTrustThisDevice: twoFactor.setter.setTrustThisDevice,
        },
        handler: {
            handleSubmit,
            handlePasskeyLogin,
            handleTwoFactorSubmit: twoFactor.handler.handleTwoFactorSubmit,
            handleTwoFactorChange: twoFactor.handler.handleTwoFactorChange,
            handleBackToLogin: twoFactor.handler.handleBackToLogin,
            handleTwoFactorRef: twoFactor.handler.handleTwoFactorRef,
        },
    }
}
