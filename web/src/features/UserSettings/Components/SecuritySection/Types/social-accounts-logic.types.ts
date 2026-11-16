import type { CurrentUserReauthenticationInput } from '../../../Types/user-settings-server-input.types.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

export type SocialAccountsLogicReturn = {
    state: {
        providers: Array<{
            id: SocialProviderId
            name: string
            isConnected: boolean
        }>
        isLoading: boolean
        hasLoadError: boolean
        isLinking: boolean
        isUnlinking: boolean
        unlinkingProvider: SocialProviderId | null
        canLink: boolean
        hasProviders: boolean
        reauthenticationMethod: CurrentUserReauthenticationInput['method']
        reauthenticationValue: string
    }
    handler: {
        handleConnect: (provider: SocialProviderId) => void
        handleDisconnect: (provider: SocialProviderId) => void
        handleReauthenticationValueChange: (value: string) => void
    }
}
