import { authorizationCodeGrant } from 'openid-client'
import { z } from 'zod'
import { SOCIAL_AUTH_POLICY } from '@/config/social-auth.config.ts'
import type { SocialIdentity, SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'
import { getSocialClientConfigurationService, getSocialProviderService } from './config.service.ts'

const oidcProfileSchema = z.object({ sub: z.string().min(1).max(255), email: z.string().optional(), email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional() })
const oauthProfileSchema = z.object({ id: z.string().min(1).max(255), email: z.string().nullish(), verified: z.boolean().optional() })

function normalizeProviderEmail(value: unknown) {
    const parsed = z.email().max(255).safeParse(typeof value === 'string' ? value.trim().toLowerCase() : value)
    return parsed.success ? parsed.data : null
}

async function fetchProviderProfileService(url: string, accessToken: string) {
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'RentnerProxy-Marketplace' },
        redirect: 'error', signal: AbortSignal.timeout(SOCIAL_AUTH_POLICY.requestTimeoutSeconds * 1000),
    })
    if (!response.ok) throw new Error('Anmeldeprofil konnte nicht geladen werden.')
    const payload: unknown = await response.json()
    return payload
}

export async function getSocialIdentityFromCallbackService(provider: SocialProviderId, callbackUrl: URL, state: { state: string; codeVerifier: string; nonce: string }): Promise<SocialIdentity> {
    const definition = getSocialProviderService(provider)
    const configuration = await getSocialClientConfigurationService(provider)
    const tokens = await authorizationCodeGrant(configuration, callbackUrl, {
        expectedState: state.state,
        ...(definition.pkce ? { pkceCodeVerifier: state.codeVerifier } : {}),
        ...(definition.jwks ? { expectedNonce: state.nonce, idTokenExpected: true } : {}),
    })
    if (definition.jwks) {
        const profile = oidcProfileSchema.parse(tokens.claims())
        const email = normalizeProviderEmail(profile.email)
        return { provider, subject: profile.sub, email, emailVerified: email !== null && (profile.email_verified === true || profile.email_verified === 'true') }
    }
    if (provider === 'github') {
        const [profileData, emailData] = await Promise.all([
            fetchProviderProfileService('https://api.github.com/user', tokens.access_token),
            fetchProviderProfileService('https://api.github.com/user/emails', tokens.access_token),
        ])
        const profile = z.object({ id: z.number().int().positive().safe() }).parse(profileData)
        const emails = z.array(z.object({ email: z.string(), primary: z.boolean(), verified: z.boolean() })).parse(emailData)
        const email = normalizeProviderEmail(emails.find((entry) => entry.primary && entry.verified)?.email ?? emails.find((entry) => entry.verified)?.email)
        return { provider, subject: String(profile.id), email, emailVerified: email !== null }
    }
    const url = 'https://discord.com/api/v10/users/@me'
    const profile = oauthProfileSchema.parse(await fetchProviderProfileService(url, tokens.access_token))
    const email = normalizeProviderEmail(profile.email)
    return { provider, subject: profile.id, email, emailVerified: profile.verified === true && email !== null }
}
