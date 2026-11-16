import { z } from 'zod'

export const socialProviderSchema = z.enum(['google', 'github', 'discord'])
export const socialIdentitySchema = z.object({
    provider: socialProviderSchema,
    subject: z.string().min(1).max(255),
    email: z.email().max(255).nullable(),
    emailVerified: z.boolean(),
})

export const socialLinkProofSchema = z.object({
    userId: z.uuid(),
    sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
    credentialVersion: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().int(),
})
