import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Configuration } from 'openid-client'
import { z } from 'zod'
import {
    SOCIAL_AUTH_POLICY,
    SOCIAL_PROVIDERS,
} from '@/config/social-auth.config.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

const proof = {
    userId: '00000000-0000-4000-8000-000000000001',
    sessionHash: 'a'.repeat(64),
    credentialVersion: 'b'.repeat(64),
    expiresAt: Date.now() + 60_000,
}
const identity = {
    provider: 'github' as SocialProviderId,
    subject: 'stable-provider-subject',
    email: 'member@example.test',
    emailVerified: true,
}
const token = 's'.repeat(43)
const browser = 'b'.repeat(43)
const cookies = new Map<string, string>()
let challenge: { payload: unknown } | null = null
const readChallenge = mock(async (..._arguments: unknown[]) => {
    const current = challenge
    if (_arguments[4] === true) challenge = null
    return current
})
const handoff = mock(async (..._arguments: unknown[]) => undefined)
const store = mock(async (_input: unknown) => 'stored')
const rateLimit = mock(async (_input: unknown) => undefined)
const exchange = mock(async (..._arguments: unknown[]) => identity)
const signIn = mock(async (_identity: unknown) => ({
    kind: 'success',
    redirectTo: '/dashboard',
    code: 'inactive',
}))
const session = mock(
    async (): Promise<{ id: string; sessionHash: string } | null> => ({
        id: proof.userId,
        sessionHash: proof.sessionHash,
    }),
)
const locked = mock(
    async (
        ..._arguments: unknown[]
    ): Promise<{ credentialVersion: string } | null> => ({
        credentialVersion: proof.credentialVersion,
    }),
)
const validateProof = mock(async (..._arguments: unknown[]) => true)
const insertValues = mock((_values: unknown) => ({
    onConflictDoNothing: () => ({ returning: async () => linkedRows }),
}))
let linkedRows = [{ id: 'linked-account' }]
let existingUsers: Array<{ id: string }> = []
let publicRegistrationEnabled = true
const transaction = { insert: () => ({ values: insertValues }) }
const transact = mock(
    async (run: (value: typeof transaction) => Promise<unknown>) =>
        run(transaction),
)
const audit = mock(async (..._arguments: unknown[]) => ({
    id: 'audit',
    createdAt: new Date(),
}))
const publish = mock(async (_receipt: unknown) => undefined)

mock.module('@/db', () => ({
    db: {
        transaction: transact,
        select: () => ({
            from: () => ({
                where: () => ({ limit: async () => existingUsers }),
            }),
        }),
    },
}))
mock.module('@/db/Schema/users.ts', () => ({
    users: { id: 'id', isDeleted: 'isDeleted', email: 'email' },
}))
mock.module('@/db/Schema/socialAuth.ts', () => ({
    socialAccounts: { id: 'id' },
}))
mock.module('drizzle-orm', () => ({
    eq: (...values: unknown[]) => values,
    and: (...values: unknown[]) => values,
    sql: (...values: unknown[]) => values,
}))
mock.module('@tanstack/react-start/server', () => ({
    getCookie: (name: string) => cookies.get(name),
    deleteCookie: (name: string) => {
        cookies.delete(name)
    },
}))
mock.module('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: rateLimit,
}))
mock.module('@/server/Auth/currentSession.ts', () => ({
    getActiveCurrentSessionUser: session,
}))
mock.module('@/server/Auth/reauthentication-proof.service.ts', () => ({
    getLockedReauthenticationStateService: locked,
    validateReauthenticationProofService: validateProof,
}))
mock.module('@/lib/Permissions/permissions.ts', () => ({
    getDefaultRouteForPermissions: () => '/dashboard',
}))
mock.module('@/lib/Permissions/userPermissions.ts', () => ({
    getUserPermissionKeys: async () => ['user.dashboard'],
}))
mock.module('@/lib/AuditLogs/auditLogs.ts', () => ({
    prepareAuditContextService: () => ({}),
    writeAuditLogInTransactionService: audit,
    publishCommittedAuditLogService: publish,
}))
mock.module('@/server/Logging/logger.ts', () => ({ logWarn: () => undefined }))
mock.module('@/server/Auth/Social/challenge.service.ts', () => ({
    readSocialChallengeService: readChallenge,
    createSocialHandoffService: handoff,
    storeSocialChallengeService: store,
    createSocialTokenService: () => browser,
    clearSocialHandoffService: async () => undefined,
    cleanupExpiredSocialChallengesService: async () => undefined,
    setSocialCookieService: (name: string, value: string) => {
        cookies.set(name, value)
    },
    getSocialHandoffCookieService: (name: string) =>
        cookies.has(name) ? { token, browserToken: browser } : null,
    socialTokenSchema: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}))
mock.module('@/server/Auth/Social/config.service.ts', () => ({
    getSocialAuthOriginService: () => new URL('https://market.example.test'),
    getSocialCallbackUrlService: (provider: string) =>
        `https://market.example.test/api/auth/${provider}/callback`,
    getSocialProviderService: (provider: string) =>
        SOCIAL_PROVIDERS.find((entry) => entry.id === provider),
    getSocialClientConfigurationService: async (provider: SocialProviderId) => {
        const definition = SOCIAL_PROVIDERS.find(
            (entry) => entry.id === provider,
        )!
        return new Configuration(
            {
                issuer: definition.issuer,
                authorization_endpoint: definition.authorization,
            },
            'fixture-client',
        )
    },
}))
mock.module('@/server/Auth/Social/profile.service.ts', () => ({
    getSocialIdentityFromCallbackService: exchange,
}))
mock.module('@/server/Auth/Social/login.service.ts', () => ({
    signInSocialIdentityService: signIn,
    SOCIAL_LOGIN_COOKIE: 'social-login',
}))
mock.module('@/server/Auth/Social/registration.service.ts', () => ({
    SOCIAL_REGISTRATION_COOKIE: 'social-registration',
}))
mock.module('@/server/Auth/Registration/policy.service.ts', () => ({
    isPublicRegistrationEnabledService: async () => publicRegistrationEnabled,
}))

const {
    beginSocialAuthorizationService,
    completeSocialLinkService,
    finishSocialCallbackService,
    getSocialCallbackParametersService,
} = await import('@/server/Auth/Social/flow.service.ts')

function callback(
    provider = 'github',
    parameters = `state=${token}&code=provider-code`,
    method = 'GET',
) {
    const url = `https://market.example.test/api/auth/${provider}/callback`
    return method === 'POST'
        ? new Request(url, {
              method,
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: parameters,
          })
        : new Request(`${url}?${parameters}`)
}

function linkChallenge() {
    cookies.set('marketplace_social_link_github', 'handoff')
    challenge = { payload: { identity, proof } }
}

beforeEach(() => {
    cookies.clear()
    cookies.set('marketplace_social_github', browser)
    cookies.set('marketplace_social_google', browser)
    challenge = {
        payload: {
            codeVerifier: 'pkce-verifier',
            nonce: 'flow-nonce',
            linkProof: null,
        },
    }
    existingUsers = []
    publicRegistrationEnabled = true
    linkedRows = [{ id: 'linked-account' }]
    for (const operation of [
        readChallenge,
        handoff,
        store,
        rateLimit,
        exchange,
        signIn,
        session,
        locked,
        validateProof,
        insertValues,
        transact,
        audit,
        publish,
    ])
        operation.mockClear()
    signIn.mockResolvedValue({
        kind: 'success',
        redirectTo: '/dashboard',
        code: 'inactive',
    })
    session.mockResolvedValue({
        id: proof.userId,
        sessionHash: proof.sessionHash,
    })
    locked.mockResolvedValue({ credentialVersion: proof.credentialVersion })
    validateProof.mockResolvedValue(true)
})

describe('Social authorization and callbacks', () => {
    it('binds fresh state, PKCE, nonce and reauthentication proof before returning the provider URL', async () => {
        const result = await beginSocialAuthorizationService('google', proof)
        const url = new URL(result.url)
        expect(url.origin).toBe('https://accounts.google.com')
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
        expect(url.searchParams.get('code_challenge')).toMatch(
            /^[A-Za-z0-9_-]{43}$/,
        )
        expect(url.searchParams.get('nonce')).toBeTruthy()
        expect(validateProof).toHaveBeenCalledWith(transaction, proof)
        expect(store).toHaveBeenCalledWith(
            expect.objectContaining({
                token: url.searchParams.get('state'),
                browserToken: browser,
                provider: 'google',
                purpose: 'authorization',
                transaction,
                payload: expect.objectContaining({
                    nonce: url.searchParams.get('nonce'),
                    linkProof: proof,
                }),
            }),
        )
    })

    it('does not stage authorization after rejected reauthentication', async () => {
        validateProof.mockResolvedValueOnce(false)
        await expect(
            beginSocialAuthorizationService('github', proof),
        ).rejects.toThrow('erneut')
        expect(store).not.toHaveBeenCalled()
    })

    it('never exchanges a code when the browser-bound state is missing or already consumed', async () => {
        challenge = null
        const response = await finishSocialCallbackService(callback(), 'github')
        expect(response.headers.get('location')).toBe(
            'https://market.example.test/login#social-error=expired',
        )
        expect(readChallenge).toHaveBeenCalledWith(
            token,
            browser,
            'authorization',
            'github',
            true,
        )
        expect(exchange).not.toHaveBeenCalled()
        expect(signIn).not.toHaveBeenCalled()
    })

    it('consumes state before exchange and rejects a replay of the same callback', async () => {
        expect(
            (
                await finishSocialCallbackService(callback(), 'github')
            ).headers.get('location'),
        ).toBe('https://market.example.test/dashboard')
        expect(
            (
                await finishSocialCallbackService(callback(), 'github')
            ).headers.get('location'),
        ).toContain('social-error=expired')
        expect(exchange).toHaveBeenCalledTimes(1)
        expect(rateLimit).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'social-callback-ip' }),
        )
    })

    it('stages linking in a browser-bound handoff before session-authorized completion', async () => {
        challenge = {
            payload: {
                codeVerifier: 'pkce-verifier',
                nonce: 'flow-nonce',
                linkProof: proof,
            },
        }
        const response = await finishSocialCallbackService(
            callback('github'),
            'github',
        )
        expect(response.status).toBe(303)
        expect(response.headers.get('location')).toBe(
            'https://market.example.test/api/auth/github/complete',
        )
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(response.headers.get('referrer-policy')).toBe('no-referrer')
        expect(handoff).toHaveBeenCalledWith(
            'marketplace_social_link_github',
            'github',
            'link_completion',
            { identity, proof },
            SOCIAL_AUTH_POLICY.challengeDurationMs,
            '/api/auth/github/complete',
        )
        expect(exchange).toHaveBeenCalledWith(
            'github',
            new URL(
                `https://market.example.test/api/auth/github/callback?state=${token}&code=provider-code`,
            ),
            {
                state: token,
                codeVerifier: 'pkce-verifier',
                nonce: 'flow-nonce',
            },
        )
        expect(session).not.toHaveBeenCalled()
        expect(signIn).not.toHaveBeenCalled()
    })

    it.each([
        `state=${token}&state=${token}&code=provider-code`,
        `state=${token}&code=first&code=second`,
    ])(
        'rejects duplicate callback parameters before state consumption: %s',
        async (parameters) => {
            expect(
                (
                    await finishSocialCallbackService(
                        callback('github', parameters),
                        'github',
                    )
                ).headers.get('location'),
            ).toContain('social-error=failed')
            expect(readChallenge).not.toHaveBeenCalled()
            expect(exchange).not.toHaveBeenCalled()
        },
    )

    it('bounds callback queries and rejects POST responses', async () => {
        const oversized = `state=${token}&code=${'x'.repeat(SOCIAL_AUTH_POLICY.maximumCallbackBytes)}`
        await expect(
            getSocialCallbackParametersService(callback('github', oversized)),
        ).rejects.toThrow('groß')
        await expect(
            getSocialCallbackParametersService(
                callback('github', undefined, 'POST'),
            ),
        ).rejects.toThrow('Antwortformat')
        await expect(
            getSocialCallbackParametersService(
                new Request(
                    'https://market.example.test/api/auth/github/callback',
                    {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: '{}',
                    },
                ),
            ),
        ).rejects.toThrow('Antwortformat')
        expect(exchange).not.toHaveBeenCalled()
    })

    it('does not auto-link an existing account matching the verified provider email', async () => {
        signIn.mockResolvedValueOnce({
            kind: 'registration',
            redirectTo: '',
            code: '',
        })
        existingUsers = [{ id: 'existing-local-account' }]
        expect(
            (
                await finishSocialCallbackService(callback(), 'github')
            ).headers.get('location'),
        ).toContain('social-error=account_exists')
        expect(handoff).not.toHaveBeenCalled()
        expect(insertValues).not.toHaveBeenCalled()
    })

    it.each([false, true])(
        'only starts a social registration handoff when registration is enabled (%s)',
        async (enabled) => {
            publicRegistrationEnabled = enabled
            signIn.mockResolvedValueOnce({
                kind: 'registration',
                redirectTo: '',
                code: '',
            })
            const response = await finishSocialCallbackService(
                callback(),
                'github',
            )
            expect(response.headers.get('location')).toBe(
                'https://market.example.test' +
                    (enabled
                        ? '/register#social'
                        : '/login#social-error=registration_disabled'),
            )
            expect(handoff).toHaveBeenCalledTimes(enabled ? 1 : 0)
        },
    )

    it('still signs an existing social account in when registration is disabled', async () => {
        publicRegistrationEnabled = false
        signIn.mockResolvedValueOnce({
            kind: 'success',
            redirectTo: '/dashboard',
            code: '',
        })
        const response = await finishSocialCallbackService(callback(), 'github')
        expect(response.headers.get('location')).toBe(
            'https://market.example.test/dashboard',
        )
        expect(handoff).not.toHaveBeenCalled()
    })

    it('leaves the callback unconsumed when IP rate limiting refuses it', async () => {
        rateLimit.mockRejectedValueOnce(new Error('Rate limited'))
        expect(
            (
                await finishSocialCallbackService(callback(), 'github')
            ).headers.get('location'),
        ).toContain('social-error=failed')
        expect(readChallenge).not.toHaveBeenCalled()
        expect(exchange).not.toHaveBeenCalled()
    })
})

describe('Social account linking completion', () => {
    it('links only with the snapshotted session and current credential version, then rejects replay', async () => {
        linkChallenge()
        expect(
            (await completeSocialLinkService('github')).headers.get('location'),
        ).toBe('https://market.example.test/dashboard#social-linked')
        expect(locked).toHaveBeenCalledWith(transaction, proof)
        expect(insertValues).toHaveBeenCalledWith({
            userId: proof.userId,
            provider: 'github',
            subject: identity.subject,
        })
        expect(publish).toHaveBeenCalledTimes(1)
        expect(
            (await completeSocialLinkService('github')).headers.get('location'),
        ).toContain('social-error=link_failed')
        expect(insertValues).toHaveBeenCalledTimes(1)
    })

    it.each([
        null,
        { id: proof.userId, sessionHash: 'different-session' },
        { id: 'other-user', sessionHash: proof.sessionHash },
    ])(
        'rejects a missing or different logged-in session: %j',
        async (current) => {
            linkChallenge()
            session.mockResolvedValueOnce(current)
            expect(
                (await completeSocialLinkService('github')).headers.get(
                    'location',
                ),
            ).toContain('social-error=link_failed')
            expect(locked).not.toHaveBeenCalled()
            expect(insertValues).not.toHaveBeenCalled()
        },
    )

    it.each([null, { credentialVersion: 'changed-credentials' }])(
        'rejects revoked sessions or credentials changed during provider authorization: %j',
        async (current) => {
            linkChallenge()
            locked.mockResolvedValueOnce(current)
            expect(
                (await completeSocialLinkService('github')).headers.get(
                    'location',
                ),
            ).toContain('social-error=link_failed')
            expect(insertValues).not.toHaveBeenCalled()
        },
    )

    it('does not report successful linking or emit a success audit when the identity is already linked', async () => {
        linkChallenge()
        linkedRows = []
        expect(
            (await completeSocialLinkService('github')).headers.get('location'),
        ).toContain('social-error=link_failed')
        expect(audit).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
    })
})
