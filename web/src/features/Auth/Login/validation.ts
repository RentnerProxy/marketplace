import { z } from 'zod'
import { authCredentialPasswordSchema } from '@/lib/Auth/validation.ts'
import { webAuthnResponseSchema } from '@/lib/Validation/zodSchemas.ts'

export const loginInputSchema = z.object({
    username: z.string().trim().min(1).max(50),
    password: authCredentialPasswordSchema,
    twoFactorCode: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    trustThisDevice: z.boolean().optional(),
})

export const beginPasskeyLoginInputSchema = z.object({
    username: z.string().trim().max(50).optional(),
})

export const finishPasskeyLoginInputSchema = z.object({
    challengeId: z.uuidv7(),
    response: webAuthnResponseSchema,
})
