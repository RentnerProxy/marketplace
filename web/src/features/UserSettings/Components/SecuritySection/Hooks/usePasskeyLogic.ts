import type { PasskeyLogicReturn } from '../Types/security-logic.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
    browserSupportsWebAuthn,
    startRegistration,
} from '@simplewebauthn/browser'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    beginCurrentUserPasskeyRegistrationHandler,
    deleteCurrentUserPasskeyHandler,
    finishCurrentUserPasskeyRegistrationHandler,
    getCurrentUserPasskeysHandler,
} from '@/features/UserSettings/middleware.ts'
import useSecurityChangeSession from './useSecurityChangeSession.ts'
import useCurrentUserReauthentication from './useCurrentUserReauthentication.ts'

const CURRENT_USER_PASSKEYS_QUERY_KEY = ['current-user-passkeys']

export default function usePasskeyLogic(): PasskeyLogicReturn {
    const { t } = useTranslationStore()
    const securitySession = useSecurityChangeSession()
    const currentSessionUser = securitySession.state.currentSessionUser
    const reauthentication = useCurrentUserReauthentication({
        isMethodResolved: Boolean(currentSessionUser),
        isTwoFactorEnabled: currentSessionUser?.isTwoFactorEnabled ?? false,
    })

    const passkeysQuery = useQuery({
        queryKey: CURRENT_USER_PASSKEYS_QUERY_KEY,
        enabled:
            securitySession.state.hasCurrentSession &&
            !securitySession.state.isReauthenticationRequired,
        queryFn: getCurrentUserPasskeysHandler,
    })

    const addPasskeyMutation = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async function () {
            if (!browserSupportsWebAuthn()) {
                throw new AppError(
                    t('userSettings.security.passkeyUnsupported'),
                )
            }

            const beginResult =
                await beginCurrentUserPasskeyRegistrationHandler({
                    data: {
                        reauthentication:
                            reauthentication.handler.createReauthenticationInput(),
                    },
                })

            if (!beginResult.success) {
                throw new AppError(beginResult.error)
            }

            const response = await startRegistration({
                optionsJSON: beginResult.options,
            })

            return await finishCurrentUserPasskeyRegistrationHandler({
                data: {
                    challengeId: beginResult.challengeId,
                    registrationToken: beginResult.registrationToken,
                    response,
                },
            })
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            reauthentication.handler.resetReauthenticationValue()
            toast.success(t('toast.passkeyAdded'), {
                title: t('userSettings.header.title'),
            })

            await securitySession.handler.completeSecurityChange()
        },
        onError: function (error) {
            toastAppError(error)
        },
        onSettled: function () {
            reauthentication.handler.resetReauthenticationValue()
            addPasskeyMutation.reset()
        },
    })

    const deletePasskeyMutation = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async function (passkeyId: string) {
            return await deleteCurrentUserPasskeyHandler({
                data: {
                    passkeyId,
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

            reauthentication.handler.resetReauthenticationValue()
            toast.success(t('toast.passkeyDeleted'), {
                title: t('userSettings.header.title'),
            })

            await securitySession.handler.completeSecurityChange()
        },
        onError: function (error) {
            toastAppError(error)
        },
        onSettled: function () {
            reauthentication.handler.resetReauthenticationValue()
            deletePasskeyMutation.reset()
        },
    })

    function handleAddPasskey() {
        if (
            securitySession.state.isReauthenticationRequired ||
            !securitySession.state.hasCurrentSession ||
            !reauthentication.state.isReauthenticationReady ||
            addPasskeyMutation.isPending ||
            deletePasskeyMutation.isPending
        ) {
            return
        }
        addPasskeyMutation.mutate()
    }

    function handleDeletePasskey(passkeyId: string) {
        if (
            securitySession.state.isReauthenticationRequired ||
            !securitySession.state.hasCurrentSession ||
            !reauthentication.state.isReauthenticationReady ||
            addPasskeyMutation.isPending ||
            deletePasskeyMutation.isPending
        ) {
            return
        }

        deletePasskeyMutation.mutate(passkeyId)
    }

    return {
        state: {
            deletingPasskeyId: deletePasskeyMutation.variables ?? null,
            isAddingPasskey: addPasskeyMutation.isPending,
            isDeletingPasskey: deletePasskeyMutation.isPending,
            isLoadingPasskeys: passkeysQuery.isLoading,
            isLoadingReauthenticationMethod:
                reauthentication.state.isLoadingReauthenticationMethod,
            isReauthenticationReady:
                securitySession.state.hasCurrentSession &&
                !securitySession.state.isReauthenticationRequired &&
                reauthentication.state.isReauthenticationReady,
            isReauthenticationRequired:
                securitySession.state.isReauthenticationRequired,
            passkeys: securitySession.state.isReauthenticationRequired
                ? []
                : (passkeysQuery.data?.passkeys ?? []),
            reauthenticationMethod:
                reauthentication.state.reauthenticationMethod,
            reauthenticationValue: reauthentication.state.reauthenticationValue,
        },
        handler: {
            handleAddPasskey,
            handleDeletePasskey,
            handleReauthenticationValueChange:
                reauthentication.handler.handleReauthenticationValueChange,
        },
    }
}
