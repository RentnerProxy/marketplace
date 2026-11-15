import { z } from 'zod'
import { passwordResetConfig } from '@/config/session.config.ts'
import { authNewPasswordSchema } from '@/lib/Auth/validation.ts'

export const updatePasswordByTokenInputSchema = z.object({
    token: z.string().trim().min(1).max(passwordResetConfig.maximumTokenLength),
    password: authNewPasswordSchema,
})

export const requestPasswordResetTokenSchema = z.object({
    token: z.string().trim().min(1).max(passwordResetConfig.maximumTokenLength),
})
