import { deleteCookie, getCookie } from '@tanstack/react-start/server'
import {
    buildAuthorizationUrl,
    calculatePKCECodeChallenge,
    randomNonce,
    randomPKCECodeVerifier,
    randomState,
} from 'openid-client'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { users } from '@/db/Schema/users.ts'
import { socialAccounts } from '@/db/Schema/socialAuth.ts'
import { SOCIAL_AUTH_POLICY } from '@/config/social-auth.config.ts'
import { RATE_LIMITS } from '@/config/security.config.ts'
import { enforceRateLimit } from '@/server/RateLimit/rateLimit.service.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { isPublicRegistrationEnabledService } from '@/server/Auth/Registration/policy.service.ts'
import {
    getLockedReauthenticationStateService,
    validateReauthenticationProofService,
} from '@/server/Auth/reauthentication-proof.service.ts'
import type { ReauthenticationProof } from '@/server/Auth/Types/reauthentication.types.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'
import { getDefaultRouteForPermissions } from '@/lib/Permissions/permissions.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import {
    prepareAuditContextService,
    publishCommittedAuditLogService,
    writeAuditLogInTransactionService,
} from '@/lib/AuditLogs/auditLogs.ts'
import { logWarn } from '@/server/Logging/logger.ts'
import {
    clearSocialHandoffService,
    cleanupExpiredSocialChallengesService,
    createSocialHandoffService,
    createSocialTokenService,
    getSocialHandoffCookieService,
    readSocialChallengeService,
    setSocialCookieService,
    socialTokenSchema,
    storeSocialChallengeService,
} from './challenge.service.ts'
import {
    getSocialAuthOriginService,
    getSocialCallbackUrlService,
    getSocialClientConfigurationService,
    getSocialProviderService,
} from './config.service.ts'
import { getSocialIdentityFromCallbackService } from './profile.service.ts'
import {
    signInSocialIdentityService,
    SOCIAL_LOGIN_COOKIE,
} from './login.service.ts'
import { SOCIAL_REGISTRATION_COOKIE } from './registration.service.ts'
import { socialIdentitySchema, socialLinkProofSchema } from './validation.ts'

const authorizationPayloadSchema = z.object({
    codeVerifier: z.string(),
    nonce: z.string(),
    linkProof: socialLinkProofSchema.nullable(),
})
const linkCompletionSchema = z.object({
    identity: socialIdentitySchema,
    proof: socialLinkProofSchema,
})

function flowCookieName(provider: SocialProviderId) {
    return `marketplace_social_${provider}`
}
function completionCookieName(provider: SocialProviderId) {
    return `marketplace_social_link_${provider}`
}
function completionPath(provider: SocialProviderId) {
    return `/api/auth/${provider}/complete`
}

export function socialRedirectResponseService(path: string) {
    return new Response(null, {
        status: 303,
        headers: {
            Location: new URL(path, getSocialAuthOriginService()).href,
            'cache-control': 'no-store',
            pragma: 'no-cache',
            'referrer-policy': 'no-referrer',
            'x-robots-tag': 'noindex, nofollow',
        },
    })
}

export async function cancelSocialAuthService() {
    await Promise.all([
        clearSocialHandoffService(SOCIAL_LOGIN_COOKIE, 'two_factor'),
        clearSocialHandoffService(SOCIAL_REGISTRATION_COOKIE, 'registration'),
    ])
    return { success: true as const }
}

export async function beginSocialAuthorizationService(
    provider: SocialProviderId,
    linkProof?: ReauthenticationProof,
) {
    const definition = getSocialProviderService(provider)
    const configuration = await getSocialClientConfigurationService(provider)
    await cleanupExpiredSocialChallengesService()
    await cancelSocialAuthService()
    const state = randomState()
    const browserToken = createSocialTokenService()
    const codeVerifier = randomPKCECodeVerifier()
    const nonce = randomNonce()
    const parameters: Record<string, string> = {
        redirect_uri: getSocialCallbackUrlService(provider),
        response_type: 'code',
        scope: definition.scopes,
        state,
    }
    if (definition.pkce) {
        parameters.code_challenge =
            await calculatePKCECodeChallenge(codeVerifier)
        parameters.code_challenge_method = 'S256'
    }
    if (definition.jwks) parameters.nonce = nonce
    const payload = { codeVerifier, nonce, linkProof: linkProof ?? null }
    await db.transaction(async (transaction) => {
        if (
            linkProof &&
            !(await validateReauthenticationProofService(
                transaction,
                linkProof,
            ))
        )
            throw new Error('Bitte bestätige deine Anmeldung erneut.')
        await storeSocialChallengeService({
            token: state,
            browserToken,
            provider,
            purpose: 'authorization',
            payload,
            durationMs: SOCIAL_AUTH_POLICY.challengeDurationMs,
            transaction,
        })
    })
    setSocialCookieService(
        flowCookieName(provider),
        browserToken,
        SOCIAL_AUTH_POLICY.challengeDurationMs,
        `/api/auth/${provider}/callback`,
    )
    return { url: buildAuthorizationUrl(configuration, parameters).href }
}

export async function getSocialCallbackParametersService(request: Request) {
    const url = new URL(request.url)
    if (url.href.length > SOCIAL_AUTH_POLICY.maximumCallbackBytes)
        throw new Error('Anmeldeantwort ist zu groß.')
    if (request.method !== 'GET') throw new Error('Ungültiges Antwortformat.')
    return url.searchParams
}

export async function finishSocialCallbackService(
    request: Request,
    provider: SocialProviderId,
) {
    try {
        await enforceRateLimit({
            ...RATE_LIMITS.socialCallbackIp,
            scope: 'social-callback-ip',
        })
        const parameters = await getSocialCallbackParametersService(request)
        if (
            [...parameters.keys()].some(
                (key) => parameters.getAll(key).length !== 1,
            )
        )
            throw new Error('Doppelte Antwortparameter.')
        const state = socialTokenSchema.parse(parameters.get('state'))
        const browserToken = getCookie(flowCookieName(provider)) ?? ''
        const flow = await readSocialChallengeService(
            state,
            browserToken,
            'authorization',
            provider,
            true,
        )
        if (!flow)
            return socialRedirectResponseService('/login#social-error=expired')
        deleteCookie(flowCookieName(provider), {
            path: `/api/auth/${provider}/callback`,
        })
        if (parameters.has('error'))
            return socialRedirectResponseService(
                '/login#social-error=cancelled',
            )
        z.string().min(1).max(4096).parse(parameters.get('code'))
        const payload = authorizationPayloadSchema.parse(flow.payload)
        const callbackUrl = new URL(getSocialCallbackUrlService(provider))
        callbackUrl.search = parameters.toString()
        const identity = await getSocialIdentityFromCallbackService(
            provider,
            callbackUrl,
            { state, codeVerifier: payload.codeVerifier, nonce: payload.nonce },
        )
        if (payload.linkProof) {
            await createSocialHandoffService(
                completionCookieName(provider),
                provider,
                'link_completion',
                { identity, proof: payload.linkProof },
                SOCIAL_AUTH_POLICY.challengeDurationMs,
                completionPath(provider),
            )
            return socialRedirectResponseService(completionPath(provider))
        }
        const login = await signInSocialIdentityService(identity)
        if (login.kind === 'success')
            return socialRedirectResponseService(login.redirectTo)
        if (login.kind === 'two_factor')
            return socialRedirectResponseService('/login#social-2fa')
        if (login.kind === 'error')
            return socialRedirectResponseService(
                `/login#social-error=${login.code}`,
            )
        if (identity.email && identity.emailVerified) {
            const existing = await db
                .select({ id: users.id })
                .from(users)
                .where(
                    and(
                        eq(users.isDeleted, false),
                        sql`lower(${users.email}) = ${identity.email}`,
                    ),
                )
                .limit(1)
            if (existing.length > 0)
                return socialRedirectResponseService(
                    '/login#social-error=account_exists',
                )
        }
        if (!(await isPublicRegistrationEnabledService()))
            return socialRedirectResponseService(
                '/login#social-error=registration_disabled',
            )
        await createSocialHandoffService(
            SOCIAL_REGISTRATION_COOKIE,
            provider,
            'registration',
            identity,
            SOCIAL_AUTH_POLICY.challengeDurationMs,
        )
        return socialRedirectResponseService('/register#social')
    } catch {
        logWarn('auth.social.callback_failed', { provider })
        return socialRedirectResponseService('/login#social-error=failed')
    }
}

export async function completeSocialLinkService(provider: SocialProviderId) {
    const cookieName = completionCookieName(provider)
    try {
        await enforceRateLimit({
            ...RATE_LIMITS.socialCallbackIp,
            scope: 'social-link-complete-ip',
        })
        const cookie = getSocialHandoffCookieService(cookieName)
        const challenge = cookie
            ? await readSocialChallengeService(
                  cookie.token,
                  cookie.browserToken,
                  'link_completion',
                  provider,
                  true,
              )
            : null
        deleteCookie(cookieName, { path: completionPath(provider) })
        if (!challenge)
            return socialRedirectResponseService(
                '/login#social-error=link_failed',
            )
        const { identity, proof } = linkCompletionSchema.parse(
            challenge.payload,
        )
        const session = await getActiveCurrentSessionUser()
        if (
            !session ||
            session.id !== proof.userId ||
            session.sessionHash !== proof.sessionHash ||
            identity.provider !== provider
        )
            return socialRedirectResponseService(
                '/login#social-error=link_failed',
            )
        const result = await db.transaction(async (transaction) => {
            const current = await getLockedReauthenticationStateService(
                transaction,
                proof,
            )
            if (
                !current ||
                current.credentialVersion !== proof.credentialVersion
            )
                return null
            const linked = await transaction
                .insert(socialAccounts)
                .values({
                    userId: proof.userId,
                    provider,
                    subject: identity.subject,
                })
                .onConflictDoNothing()
                .returning({ id: socialAccounts.id })
            if (linked.length !== 1) return null
            const auditReceipt = await writeAuditLogInTransactionService(
                transaction,
                {
                    ...prepareAuditContextService(proof.userId),
                    action: 'auth.social_account_linked',
                    message: `Anmeldeanbieter ${provider} wurde bewusst verknüpft.`,
                    newValues: { provider },
                },
            )
            return {
                auditReceipt,
                redirectTo: getDefaultRouteForPermissions(
                    await getUserPermissionKeys(proof.userId, transaction),
                ),
            }
        })
        if (!result)
            return socialRedirectResponseService(
                '/login#social-error=link_failed',
            )
        await publishCommittedAuditLogService(result.auditReceipt)
        return socialRedirectResponseService(
            `${result.redirectTo}#social-linked`,
        )
    } catch {
        logWarn('auth.social.link_failed', { provider })
        return socialRedirectResponseService('/login#social-error=link_failed')
    }
}
