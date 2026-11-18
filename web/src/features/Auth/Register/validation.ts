import { z } from 'zod'
import { REGISTRATION_POLICY } from '@/config/security.config.ts'
import { registrationTokenPattern } from '@/lib/Auth/registrationToken.ts'

export const registrationInputSchema = z.object({
    username: z
        .string()
        .trim()
        .min(3)
        .max(50)
        .regex(/^[a-zA-Z0-9_-]+$/u),
    email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
    password: z
        .string()
        .min(REGISTRATION_POLICY.minimumPasswordLength)
        .max(1024)
        .optional(),
    acceptTerms: z.literal(true),
})

export const verifyRegistrationInputSchema = z.object({
    token: z.string().length(43).regex(registrationTokenPattern),
})
