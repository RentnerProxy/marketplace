import type { CurrentUserReauthenticationInput } from '../../../Types/user-settings-server-input.types.ts'

export type CurrentUserReauthenticationOptions = {
    isMethodResolved: boolean
    isTwoFactorEnabled: boolean
}

export type CurrentUserReauthenticationReturn = {
    state: {
        isLoadingReauthenticationMethod: boolean
        isReauthenticationReady: boolean
        reauthenticationMethod: CurrentUserReauthenticationInput['method']
        reauthenticationValue: string
    }
    handler: {
        createReauthenticationInput: () => CurrentUserReauthenticationInput
        handleReauthenticationValueChange: (value: string) => void
        resetReauthenticationValue: () => void
    }
}
