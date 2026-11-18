import type { z } from 'zod'
import type {
    convertAccountTypeInputSchema,
    deleteUserInputSchema,
    resetUserPasswordInputSchema,
    setUserActiveInputSchema,
    updateUserProfileInputSchema,
} from '../validation.ts'

export type DeleteUserInput = z.infer<typeof deleteUserInputSchema>
export type ConvertAccountTypeInput = z.infer<
    typeof convertAccountTypeInputSchema
>
export type ResetUserPasswordInput = z.infer<
    typeof resetUserPasswordInputSchema
>
export type SetUserActiveInput = z.infer<typeof setUserActiveInputSchema>
export type UpdateUserProfileInput = z.infer<
    typeof updateUserProfileInputSchema
>
