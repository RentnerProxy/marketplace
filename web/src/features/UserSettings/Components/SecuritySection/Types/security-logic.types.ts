import type { CurrentUserReauthenticationInput } from '../../../Types/user-settings-server-input.types.ts'
import type { getCurrentUserPasskeysHandler } from '../../../middleware.ts'

export type PasswordResetLogicReturn = {
    state: { isRequestingPasswordReset: boolean }
    handler: { handleRequestPasswordReset: () => void }
}

export type PasskeyLogicReturn = {
    state: {
        deletingPasskeyId: string | null
        isAddingPasskey: boolean
        isDeletingPasskey: boolean
        isLoadingPasskeys: boolean
        isLoadingReauthenticationMethod: boolean
        isReauthenticationReady: boolean
        isReauthenticationRequired: boolean
        passkeys: Awaited<
            ReturnType<typeof getCurrentUserPasskeysHandler>
        >['passkeys']
        reauthenticationMethod: CurrentUserReauthenticationInput['method']
        reauthenticationValue: string
    }
    handler: {
        handleAddPasskey: () => void
        handleDeletePasskey: (passkeyId: string) => void
        handleReauthenticationValueChange: (value: string) => void
    }
}

export type TwoFactorLogicReturn = {
    state: {
        copySecret: boolean
        isConfirmingTwoFactorSetup: boolean
        isDisablingTwoFactor: boolean
        isLoadingTwoFactorStatus: boolean
        isStartingTwoFactorSetup: boolean
        isTwoFactorBusy: boolean
        isTwoFactorEnabled: boolean
        isReauthenticationRequired: boolean
        isTwoFactorSetupPending: boolean
        twoFactorOtpAuthUrl: string | null
        twoFactorReauthenticationValue: string
        twoFactorSecret: string | null
        twoFactorToken: string
        isTwoFactorReauthenticationReady: boolean
        reauthenticationMethod: CurrentUserReauthenticationInput['method']
    }
    handler: {
        handleConfirmTwoFactorSetup: () => void
        handleCopySecret: () => Promise<void>
        handleDisableTwoFactor: () => void
        handleStartTwoFactorSetup: () => void
        handleTwoFactorTokenChange: (value: string) => void
        handleTwoFactorReauthenticationValueChange: (value: string) => void
    }
}
