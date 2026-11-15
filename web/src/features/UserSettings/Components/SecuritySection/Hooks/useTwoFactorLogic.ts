import type { TwoFactorLogicReturn } from '../Types/security-logic.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import useSecurityChangeSession from './useSecurityChangeSession.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    beginCurrentUserTwoFactorSetupHandler,
    confirmCurrentUserTwoFactorSetupHandler,
    disableCurrentUserTwoFactorHandler,
    getCurrentTwoFactorStatusHandler,
} from '@/features/UserSettings/middleware.ts'
import useCurrentUserReauthentication from './useCurrentUserReauthentication.ts'

const CURRENT_TWO_FACTOR_STATUS_QUERY_KEY = ['current-two-factor-status']

export default function useTwoFactorLogic(): TwoFactorLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const securitySession = useSecurityChangeSession()

    const [twoFactorToken, setTwoFactorToken] = useState('')
    const [twoFactorSetupToken, setTwoFactorSetupToken] = useState('')
    const [twoFactorSecret, setTwoFactorSecret] = useState<string | null>(null)
    const [twoFactorOtpAuthUrl, setTwoFactorOtpAuthUrl] = useState<
        string | null
    >(null)
    const [copySecret, setCopySecret] = useState(false)

    const twoFactorStatusQuery = useQuery({
        queryKey: CURRENT_TWO_FACTOR_STATUS_QUERY_KEY,
        enabled:
            securitySession.state.hasCurrentSession &&
            !securitySession.state.isReauthenticationRequired,
        queryFn: getCurrentTwoFactorStatusHandler,
    })
    const isTwoFactorEnabled = twoFactorStatusQuery.data?.isEnabled ?? false
    const reauthentication = useCurrentUserReauthentication({
        isMethodResolved: Boolean(twoFactorStatusQuery.data),
        isTwoFactorEnabled,
    })

    const startTwoFactorSetupMutation = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async function () {
            return await beginCurrentUserTwoFactorSetupHandler({
                data: {
                    reauthentication:
                        reauthentication.handler.createReauthenticationInput(),
                },
            })
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            setTwoFactorSetupToken(result.setupToken)
            setTwoFactorSecret(result.secret)
            setTwoFactorOtpAuthUrl(result.otpAuthUrl)
            setTwoFactorToken('')
            setCopySecret(false)

            await queryClient.invalidateQueries({
                queryKey: CURRENT_TWO_FACTOR_STATUS_QUERY_KEY,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
        onSettled: function () {
            reauthentication.handler.resetReauthenticationValue()
            startTwoFactorSetupMutation.reset()
        },
    })

    const confirmTwoFactorSetupMutation = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async function () {
            return await confirmCurrentUserTwoFactorSetupHandler({
                data: {
                    setupToken: twoFactorSetupToken,
                    token: twoFactorToken,
                },
            })
        },
        onSuccess: async function (result) {
            if (!result.success) {
                if ('restartSetup' in result && result.restartSetup === true) {
                    resetTwoFactorSetupState()
                    await queryClient.invalidateQueries({
                        queryKey: CURRENT_TWO_FACTOR_STATUS_QUERY_KEY,
                    })
                }

                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.twoFactorEnabled'), {
                title: t('userSettings.header.title'),
            })

            resetTwoFactorSetupState()

            await securitySession.handler.completeSecurityChange()
        },
        onError: function (error) {
            toastAppError(error)
        },
        onSettled: function () {
            confirmTwoFactorSetupMutation.reset()
        },
    })

    const disableTwoFactorMutation = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async function () {
            return await disableCurrentUserTwoFactorHandler({
                data: {
                    reauthentication:
                        reauthentication.handler.createReauthenticationInput(),
                },
            })
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.twoFactorDisabled'), {
                title: t('userSettings.header.title'),
            })

            resetTwoFactorSetupState()

            await securitySession.handler.completeSecurityChange()
        },
        onError: function (error) {
            toastAppError(error)
        },
        onSettled: function () {
            reauthentication.handler.resetReauthenticationValue()
            disableTwoFactorMutation.reset()
        },
    })

    const isTwoFactorBusy =
        securitySession.state.isReauthenticationRequired ||
        !securitySession.state.hasCurrentSession ||
        startTwoFactorSetupMutation.isPending ||
        confirmTwoFactorSetupMutation.isPending ||
        disableTwoFactorMutation.isPending

    function resetTwoFactorSetupState() {
        startTwoFactorSetupMutation.reset()
        setTwoFactorSetupToken('')
        setTwoFactorSecret(null)
        setTwoFactorOtpAuthUrl(null)
        setTwoFactorToken('')
        reauthentication.handler.resetReauthenticationValue()
        setCopySecret(false)
    }

    async function handleCopySecret() {
        if (!twoFactorSecret) {
            return
        }

        try {
            await navigator.clipboard.writeText(twoFactorSecret)
            setCopySecret(true)

            window.setTimeout(function () {
                setCopySecret(false)
            }, 2000)
        } catch {
            toastAppError(new AppError(t('userSettings.security.copyFailed')))
        }
    }

    function handleConfirmTwoFactorSetup() {
        if (
            !twoFactorSetupToken ||
            twoFactorToken.length !== 6 ||
            isTwoFactorBusy ||
            twoFactorStatusQuery.isLoading ||
            isTwoFactorEnabled
        ) {
            return
        }

        confirmTwoFactorSetupMutation.mutate()
    }

    function handleDisableTwoFactor() {
        if (
            !isTwoFactorEnabled ||
            !reauthentication.state.isReauthenticationReady ||
            isTwoFactorBusy ||
            twoFactorStatusQuery.isLoading
        ) {
            return
        }

        disableTwoFactorMutation.mutate()
    }

    function handleStartTwoFactorSetup() {
        if (
            isTwoFactorEnabled ||
            !reauthentication.state.isReauthenticationReady ||
            isTwoFactorBusy ||
            twoFactorStatusQuery.isLoading
        ) {
            return
        }

        startTwoFactorSetupMutation.mutate()
    }

    function handleTwoFactorTokenChange(value: string) {
        const normalizedValue = value.replace(/\D/g, '').slice(0, 6)

        setTwoFactorToken(normalizedValue)
    }

    return {
        state: {
            copySecret,
            isConfirmingTwoFactorSetup: confirmTwoFactorSetupMutation.isPending,
            isDisablingTwoFactor: disableTwoFactorMutation.isPending,
            isLoadingTwoFactorStatus: twoFactorStatusQuery.isLoading,
            isStartingTwoFactorSetup: startTwoFactorSetupMutation.isPending,
            isTwoFactorBusy,
            isTwoFactorEnabled,
            isReauthenticationRequired:
                securitySession.state.isReauthenticationRequired,
            isTwoFactorSetupPending:
                twoFactorStatusQuery.data?.isSetupPending ?? false,
            twoFactorOtpAuthUrl,
            twoFactorReauthenticationValue:
                reauthentication.state.reauthenticationValue,
            twoFactorSecret,
            twoFactorToken,
            isTwoFactorReauthenticationReady:
                reauthentication.state.isReauthenticationReady,
            reauthenticationMethod:
                reauthentication.state.reauthenticationMethod,
        },
        handler: {
            handleConfirmTwoFactorSetup,
            handleCopySecret,
            handleDisableTwoFactor,
            handleStartTwoFactorSetup,
            handleTwoFactorTokenChange,
            handleTwoFactorReauthenticationValueChange:
                reauthentication.handler.handleReauthenticationValueChange,
        },
    }
}
