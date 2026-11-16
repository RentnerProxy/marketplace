import { z } from 'zod'
import { SOCIAL_PROVIDERS } from '@/config/social-auth.config.ts'
import { currentUserReauthenticationInputSchema } from '../validation.ts'

export const socialProviderIdSchema = z.enum(SOCIAL_PROVIDERS.map((provider) => provider.id))

export const beginSocialLinkInputSchema = z.object({
    provider: socialProviderIdSchema,
    reauthentication: currentUserReauthenticationInputSchema,
})
