import { z } from 'zod'

export const socialProviderInputSchema = z.object({ provider: z.enum(['google', 'github', 'discord']) })
export const finishSocialLoginInputSchema = z.object({ twoFactorCode: z.string().regex(/^\d{6}$/) })
