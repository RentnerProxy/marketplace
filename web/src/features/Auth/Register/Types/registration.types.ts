import type { z } from 'zod'
import type { registrationInputSchema, verifyRegistrationInputSchema } from '../validation.ts'

export type RegistrationInput = z.infer<typeof registrationInputSchema>
export type VerifyRegistrationInput = z.infer<typeof verifyRegistrationInputSchema>
export type RegistrationResult =
    | { success: true; requiresEmailVerification: boolean; redirectTo?: string }
    | { success: false; error: string }
export type VerifyRegistrationResult = { success: boolean; error?: string }
