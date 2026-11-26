import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { isTranslationKey } from '@/language/translation.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import {
    beginSocialLinkHandler,
    getSocialAccountsHandler,
    unlinkSocialAccountHandler,
} from '../../../SocialAccounts/middleware.ts'
import useCurrentUserReauthentication from './useCurrentUserReauthentication.ts'
import type { SocialAccountsLogicReturn } from '../Types/social-accounts-logic.types.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'
import { SOCIAL_PROVIDERS } from '@/config/social-auth.config.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

export default function useSocialAccountsLogic(): SocialAccountsLogicReturn {
    const { t } = useTranslationStore()
    const actionInFlight = useRef(false)
    const session = useQuery(authenticatedSessionQueryOptions())
    const currentUser = session.data?.user
    const reauthentication = useCurrentUserReauthentication({
        isMethodResolved: Boolean(currentUser),
        isTwoFactorEnabled: currentUser?.isTwoFactorEnabled ?? false,
    })
    const accounts = useQuery({
        queryKey: ['current-user-social-accounts', currentUser?.id],
        enabled: Boolean(currentUser),
        queryFn: getSocialAccountsHandler,
    })
    const linking = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async (provider: SocialProviderId) => {
            const result = await beginSocialLinkHandler({
                data: {
                    provider,
                    reauthentication:
                        reauthentication.handler.createReauthenticationInput(),
                },
            })
            if (!result.success) throw new AppError(result.error)
            return result.url
        },
        onSuccess: (url) => {
            window.location.assign(url)
        },
        onError: toastAppError,
        onSettled: () => {
            actionInFlight.current = false
            reauthentication.handler.resetReauthenticationValue()
            linking.reset()
        },
    })
    const unlinking = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async (provider: SocialProviderId) => {
            const result = await unlinkSocialAccountHandler({
                data: {
                    provider,
                    reauthentication:
                        reauthentication.handler.createReauthenticationInput(),
                },
            })
            if (!result.success)
                throw new AppError(
                    result.error.startsWith('auth.social.') &&
                        isTranslationKey(result.error)
                        ? t(result.error)
                        : result.error,
                )
        },
        onSuccess: async () => {
            toast.success(t('auth.social.unlinked'), {
                title: t('userSettings.header.title'),
            })
            await accounts.refetch()
        },
        onError: toastAppError,
        onSettled: () => {
            actionInFlight.current = false
            reauthentication.handler.resetReauthenticationValue()
            unlinking.reset()
        },
    })
    const connected = new Set(
        accounts.data?.accounts.map((account) => account.provider),
    )
    const available = accounts.data?.providers ?? []
    const providers = SOCIAL_PROVIDERS.filter(
        (provider) =>
            connected.has(provider.id) ||
            available.some((candidate) => candidate.id === provider.id),
    ).map((provider) => ({
        id: provider.id,
        name: provider.name,
        isConnected: connected.has(provider.id),
    }))
    const canLink =
        Boolean(currentUser) &&
        reauthentication.state.isReauthenticationReady &&
        !linking.isPending &&
        !unlinking.isPending

    function handleConnect(provider: SocialProviderId) {
        if (
            !canLink ||
            actionInFlight.current ||
            connected.has(provider) ||
            !available.some((candidate) => candidate.id === provider)
        )
            return
        actionInFlight.current = true
        linking.mutate(provider)
    }

    function handleDisconnect(provider: SocialProviderId) {
        if (!canLink || actionInFlight.current || !connected.has(provider))
            return
        actionInFlight.current = true
        unlinking.mutate(provider)
    }

    return {
        state: {
            providers,
            isLoading: session.isLoading || accounts.isLoading,
            hasLoadError: accounts.isError,
            isLinking: linking.isPending,
            isUnlinking: unlinking.isPending,
            unlinkingProvider: unlinking.variables ?? null,
            canLink,
            hasProviders: providers.length > 0,
            reauthenticationMethod:
                reauthentication.state.reauthenticationMethod,
            reauthenticationValue: reauthentication.state.reauthenticationValue,
        },
        handler: {
            handleConnect,
            handleDisconnect,
            handleReauthenticationValueChange:
                reauthentication.handler.handleReauthenticationValueChange,
        },
    }
}
