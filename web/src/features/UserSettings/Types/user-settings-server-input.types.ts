import type { z } from 'zod'
import type {
    beginCurrentUserPasskeyRegistrationInputSchema,
    beginCurrentUserTwoFactorSetupInputSchema,
    confirmCurrentUserTwoFactorSetupInputSchema,
    currentUserReauthenticationInputSchema,
    deleteCurrentUserPasskeyInputSchema,
    disableCurrentUserTwoFactorInputSchema,
    finishCurrentUserPasskeyRegistrationInputSchema,
    updateCurrentUserBackgroundAppearanceInputSchema,
    updateCurrentUserBackgroundInputSchema,
    updateCurrentUserFontFamilyInputSchema,
    updateCurrentUserFontSizeInputSchema,
    updateCurrentUserPersonalInfoInputSchema,
    updateCurrentUserPrimaryColorInputSchema,
    updateCurrentUserProfileImageInputSchema,
    updateCurrentUserThemeModeInputSchema,
} from '../validation.ts'

export type CurrentUserReauthenticationInput = z.infer<
    typeof currentUserReauthenticationInputSchema
>
export type DisableCurrentUserTwoFactorInput = z.infer<
    typeof disableCurrentUserTwoFactorInputSchema
>
export type BeginCurrentUserPasskeyRegistrationInput = z.infer<
    typeof beginCurrentUserPasskeyRegistrationInputSchema
>
export type BeginCurrentUserTwoFactorSetupInput = z.infer<
    typeof beginCurrentUserTwoFactorSetupInputSchema
>
export type ConfirmCurrentUserTwoFactorSetupInput = z.infer<
    typeof confirmCurrentUserTwoFactorSetupInputSchema
>
export type FinishCurrentUserPasskeyRegistrationInput = z.infer<
    typeof finishCurrentUserPasskeyRegistrationInputSchema
>
export type DeleteCurrentUserPasskeyInput = z.infer<
    typeof deleteCurrentUserPasskeyInputSchema
>
export type UpdateCurrentUserBackgroundAppearanceInput = z.infer<
    typeof updateCurrentUserBackgroundAppearanceInputSchema
>
export type UpdateCurrentUserBackgroundInput = z.infer<
    typeof updateCurrentUserBackgroundInputSchema
>
export type UpdateCurrentUserFontFamilyInput = z.infer<
    typeof updateCurrentUserFontFamilyInputSchema
>
export type UpdateCurrentUserFontSizeInput = z.infer<
    typeof updateCurrentUserFontSizeInputSchema
>
export type UpdateCurrentUserPersonalInfoInput = z.infer<
    typeof updateCurrentUserPersonalInfoInputSchema
>
export type UpdateCurrentUserPrimaryColorInput = z.infer<
    typeof updateCurrentUserPrimaryColorInputSchema
>
export type UpdateCurrentUserProfileImageInput = z.infer<
    typeof updateCurrentUserProfileImageInputSchema
>
export type UpdateCurrentUserThemeModeInput = z.infer<
    typeof updateCurrentUserThemeModeInputSchema
>
