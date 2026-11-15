import type { z } from 'zod'
import type {
    createUserInputSchema,
    deleteUserInputSchema,
    resetUserPasswordInputSchema,
    setUserActiveInputSchema,
    updateUserProfileInputSchema,
} from '../validation.ts'

export type CreateUserInput = z.infer<typeof createUserInputSchema>
export type DeleteUserInput = z.infer<typeof deleteUserInputSchema>
export type ResetUserPasswordInput = z.infer<
    typeof resetUserPasswordInputSchema
>
export type SetUserActiveInput = z.infer<typeof setUserActiveInputSchema>
export type UpdateUserProfileInput = z.infer<
    typeof updateUserProfileInputSchema
>
