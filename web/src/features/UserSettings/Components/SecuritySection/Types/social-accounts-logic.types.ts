import type { CurrentUserReauthenticationInput } from '../../../Types/user-settings-server-input.types.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

export type SocialAccountsLogicReturn = {
    state: {
        providers: Array<{ id: SocialProviderId; name: string; isConnected: boolean }>
        isLoading: boolean
        hasLoadError: boolean
        isLinking: boolean
        canLink: boolean
        hasUnlinkedProviders: boolean
        reauthenticationMethod: CurrentUserReauthenticationInput['method']
        reauthenticationValue: string
    }
    handler: {
        handleConnect: (provider: SocialProviderId) => void
        handleReauthenticationValueChange: (value: string) => void
    }
}
