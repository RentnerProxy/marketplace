import { useMutation, useQuery } from '@tanstack/react-query'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { beginSocialLinkHandler, getSocialAccountsHandler } from '../../../SocialAccounts/middleware.ts'
import useCurrentUserReauthentication from './useCurrentUserReauthentication.ts'
import type { SocialAccountsLogicReturn } from '../Types/social-accounts-logic.types.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'
import { SOCIAL_PROVIDERS } from '@/config/social-auth.config.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

export default function useSocialAccountsLogic(): SocialAccountsLogicReturn {
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
            const result = await beginSocialLinkHandler({ data: {
                provider,
                reauthentication: reauthentication.handler.createReauthenticationInput(),
            } })
            if (!result.success) throw new AppError(result.error)
            return result.url
        },
        onSuccess: (url) => { window.location.assign(url) },
        onError: toastAppError,
        onSettled: () => {
            reauthentication.handler.resetReauthenticationValue()
            linking.reset()
        },
    })
    const connected = new Set(accounts.data?.accounts.map((account) => account.provider))
    const available = accounts.data?.providers ?? []
    const providers = SOCIAL_PROVIDERS.filter((provider) => connected.has(provider.id) || available.some((candidate) => candidate.id === provider.id))
        .map((provider) => ({ id: provider.id, name: provider.name, isConnected: connected.has(provider.id) }))
    const canLink = Boolean(currentUser) && reauthentication.state.isReauthenticationReady && !linking.isPending

    function handleConnect(provider: SocialProviderId) {
        if (!canLink || connected.has(provider) || !available.some((candidate) => candidate.id === provider)) return
        linking.mutate(provider)
    }

    return {
        state: {
            providers,
            isLoading: session.isLoading || accounts.isLoading,
            hasLoadError: accounts.isError,
            isLinking: linking.isPending,
            canLink,
            hasUnlinkedProviders: providers.some((provider) => !provider.isConnected),
            reauthenticationMethod: reauthentication.state.reauthenticationMethod,
            reauthenticationValue: reauthentication.state.reauthenticationValue,
        },
        handler: {
            handleConnect,
            handleReauthenticationValueChange: reauthentication.handler.handleReauthenticationValueChange,
        },
    }
}
