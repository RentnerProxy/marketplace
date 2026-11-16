import { createServerFn } from '@tanstack/react-start'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { beginSocialAuthorizationService, cancelSocialAuthService } from '@/server/Auth/Social/flow.service.ts'
import { getConfiguredSocialProvidersService } from '@/server/Auth/Social/config.service.ts'
import { getSocialRegistrationIdentityService } from '@/server/Auth/Social/registration.service.ts'
import { finishSocialLoginService, getSocialLoginChallengeService } from '@/server/Auth/Social/login.service.ts'
import type { SocialAuthState } from '@/lib/Auth/Types/social-auth.types.ts'
import { finishSocialLoginInputSchema, socialProviderInputSchema } from './validation.ts'

export const getSocialAuthStateHandler = createServerFn({ method: 'GET' }).handler(async (): Promise<SocialAuthState> => {
    const [registration, challenge] = await Promise.all([getSocialRegistrationIdentityService(), getSocialLoginChallengeService()])
    return { providers: getConfiguredSocialProvidersService(), registration: registration ? { provider: registration.provider, email: registration.email, emailVerified: registration.emailVerified } : null, requiresTwoFactor: challenge !== null }
})

export const beginSocialLoginHandler = createServerFn({ method: 'POST' }).validator((data: unknown) => socialProviderInputSchema.parse(data)).handler(async ({ data }) => {
    await enforceRateLimit({ ...RATE_LIMITS.socialStartIp, scope: 'social-start-ip' })
    return beginSocialAuthorizationService(data.provider)
})

export const finishSocialLoginHandler = createServerFn({ method: 'POST' }).validator((data: unknown) => finishSocialLoginInputSchema.parse(data)).handler(async ({ data }) => {
    await enforceRateLimit({ ...RATE_LIMITS.socialTwoFactorIp, scope: 'social-two-factor-ip' })
    return finishSocialLoginService(data.twoFactorCode)
})

export const cancelSocialAuthHandler = createServerFn({ method: 'POST' }).handler(() => cancelSocialAuthService())
