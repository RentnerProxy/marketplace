import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'bun:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { CryptoKey } from 'jose'
import { getSocialIdentityFromCallbackService } from '@/server/Auth/Social/profile.service.ts'
import {
    getConfiguredSocialProvidersService,
    getSocialClientConfigurationService,
    getSocialProviderService,
} from '@/server/Auth/Social/config.service.ts'
import {
    parseSocialAuthEnvironmentService,
    socialAuthEnvironmentFields,
} from '@/server/Runtime/social-auth-environment.service.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

const environmentKeys = Object.keys(socialAuthEnvironmentFields)
const savedEnvironment = new Map(
    environmentKeys.map((key) => [key, process.env[key]]),
)
const fetchMock = vi.spyOn(globalThis, 'fetch')
let signingKey: CryptoKey
let otherKey: CryptoKey
let publicKey: Record<string, unknown>
let tokenClaims: Record<string, unknown>
let tokenSignatureValid = true
let includeIdToken = true
let tokenStatus = 200
let providerPayload: unknown = {
    id: 'provider-subject',
    email: 'member@example.test',
    verified: true,
}
const tokenRequests: URLSearchParams[] = []

beforeAll(async () => {
    const pair = await generateKeyPair('RS256')
    signingKey = pair.privateKey
    publicKey = {
        ...(await exportJWK(pair.publicKey)),
        kid: 'fixture',
        alg: 'RS256',
    }
    otherKey = (await generateKeyPair('RS256')).privateKey
})

beforeEach(() => {
    for (const key of environmentKeys) delete process.env[key]
    process.env.OAUTH_GOOGLE_CLIENT_ID = 'google-client'
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'fixture-secret'
    tokenClaims = {
        iss: 'https://accounts.google.com',
        aud: 'google-client',
        sub: 'stable-google-subject',
        nonce: 'fixture-nonce',
        email: 'MEMBER@example.test',
        email_verified: true,
    }
    tokenSignatureValid = true
    includeIdToken = true
    tokenStatus = 200
    providerPayload = {
        id: 'provider-subject',
        email: 'member@example.test',
        verified: true,
    }
    fetchMock.mockClear()
    tokenRequests.length = 0
    fetchMock.mockImplementation(
        Object.assign(
            async (input: string | URL | Request, init?: RequestInit) => {
                const url = new URL(
                    input instanceof Request ? input.url : input.toString(),
                )
                if (
                    url.pathname.endsWith('/token') ||
                    url.pathname.endsWith('/access_token')
                ) {
                    tokenRequests.push(
                        new URLSearchParams(String(init?.body ?? '')),
                    )
                    if (tokenStatus !== 200)
                        return Response.json(
                            { error: 'invalid_grant' },
                            { status: tokenStatus },
                        )
                    const idToken = await new SignJWT(tokenClaims)
                        .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
                        .setIssuedAt()
                        .setExpirationTime('5m')
                        .sign(tokenSignatureValid ? signingKey : otherKey)
                    return Response.json({
                        access_token: 'fixture-access-token',
                        token_type: 'Bearer',
                        expires_in: 300,
                        ...(includeIdToken ? { id_token: idToken } : {}),
                    })
                }
                if (
                    url.pathname.endsWith('/certs') ||
                    url.pathname.endsWith('/keys')
                )
                    return Response.json({ keys: [publicKey] })
                if (
                    url.hostname === 'api.github.com' &&
                    url.pathname === '/user/emails'
                )
                    return Response.json([
                        {
                            email: 'unverified@example.test',
                            primary: true,
                            verified: false,
                        },
                        {
                            email: 'member@example.test',
                            primary: false,
                            verified: true,
                        },
                    ])
                expect(init?.redirect).toBe('error')
                expect(new Headers(init?.headers).get('Authorization')).toBe(
                    'Bearer fixture-access-token',
                )
                return Response.json(providerPayload)
            },
            { preconnect: () => {} },
        ),
    )
})

afterAll(() => {
    fetchMock.mockRestore()
    for (const [key, value] of savedEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

function callback(provider: SocialProviderId = 'google') {
    const url = new URL(
        `https://market.example.test/api/auth/${provider}/callback?code=fixture-code&state=fixture-state`,
    )
    const issuers = {
        google: 'https://accounts.google.com',
        github: 'https://github.com/login/oauth',
        discord: 'https://discord.com',
    }
    url.searchParams.set('iss', issuers[provider])
    return url
}

const checks = {
    state: 'fixture-state',
    codeVerifier: 'fixture-verifier',
    nonce: 'fixture-nonce',
}

describe('Provider identity verification over mocked HTTPS', () => {
    it('validates a signed Google identity, nonce and PKCE before trusting its stable subject', async () => {
        expect(
            await getSocialIdentityFromCallbackService(
                'google',
                callback(),
                checks,
            ),
        ).toEqual({
            provider: 'google',
            subject: 'stable-google-subject',
            email: 'member@example.test',
            emailVerified: true,
        })
        expect(tokenRequests[0]?.get('code_verifier')).toBe('fixture-verifier')
        expect(tokenRequests[0]?.get('redirect_uri')).toBe(
            'https://market.example.test/api/auth/google/callback',
        )
    })

    it.each(['iss', 'aud', 'nonce'] as const)(
        'rejects a signed token with the wrong %s',
        async (claim) => {
            tokenClaims[claim] = 'wrong'
            await expect(
                getSocialIdentityFromCallbackService(
                    'google',
                    callback(),
                    checks,
                ),
            ).rejects.toThrow()
        },
    )

    it('rejects an invalid signature even when every identity claim is plausible', async () => {
        tokenSignatureValid = false
        await expect(
            getSocialIdentityFromCallbackService('google', callback(), checks),
        ).rejects.toThrow()
    })

    it('rejects missing ID tokens and failed authorization-code exchanges', async () => {
        includeIdToken = false
        await expect(
            getSocialIdentityFromCallbackService('google', callback(), checks),
        ).rejects.toThrow()
        tokenStatus = 400
        await expect(
            getSocialIdentityFromCallbackService('google', callback(), checks),
        ).rejects.toThrow()
    })

    it('rejects a mismatched callback state before making any token request', async () => {
        await expect(
            getSocialIdentityFromCallbackService('google', callback(), {
                ...checks,
                state: 'different',
            }),
        ).rejects.toThrow()
        expect(tokenRequests).toHaveLength(0)
    })

    it('takes GitHub identity only from authenticated APIs and selects a verified email', async () => {
        process.env.OAUTH_GITHUB_CLIENT_ID = 'github-client'
        process.env.OAUTH_GITHUB_CLIENT_SECRET = 'fixture-secret'
        includeIdToken = false
        providerPayload = { id: 12345 }
        expect(
            await getSocialIdentityFromCallbackService(
                'github',
                callback('github'),
                checks,
            ),
        ).toEqual({
            provider: 'github',
            subject: '12345',
            email: 'member@example.test',
            emailVerified: true,
        })
    })

    it.each(['github', 'discord'] as const)(
        'requires the advertised %s response issuer before exchanging a code',
        async (provider) => {
            process.env.OAUTH_GITHUB_CLIENT_ID = 'github-client'
            process.env.OAUTH_GITHUB_CLIENT_SECRET = 'fixture-secret'
            process.env.OAUTH_DISCORD_CLIENT_ID = 'discord-client'
            process.env.OAUTH_DISCORD_CLIENT_SECRET = 'fixture-secret'
            includeIdToken = false
            const url = callback(provider)
            url.searchParams.delete('iss')
            await expect(
                getSocialIdentityFromCallbackService(provider, url, checks),
            ).rejects.toThrow()
            url.searchParams.set(
                'iss',
                provider === 'github'
                    ? 'https://github.com'
                    : 'https://github.com/login/oauth',
            )
            await expect(
                getSocialIdentityFromCallbackService(provider, url, checks),
            ).rejects.toThrow()
            expect(tokenRequests).toHaveLength(0)
        },
    )

    it('preserves Discord identity without treating an unverified email as ownership', async () => {
        process.env.OAUTH_DISCORD_CLIENT_ID = 'fixture-client'
        process.env.OAUTH_DISCORD_CLIENT_SECRET = 'fixture-secret'
        includeIdToken = false
        providerPayload = {
            id: 'provider-subject',
            email: 'member@example.test',
            verified: false,
        }
        const identity = await getSocialIdentityFromCallbackService(
            'discord',
            callback('discord'),
            checks,
        )
        expect(identity.subject).toBe('provider-subject')
        expect(identity.emailVerified).toBe(false)
    })

    it('accepts Discord email ownership only when Discord marks a valid email as verified', async () => {
        process.env.OAUTH_DISCORD_CLIENT_ID = 'fixture-client'
        process.env.OAUTH_DISCORD_CLIENT_SECRET = 'fixture-secret'
        includeIdToken = false
        expect(
            await getSocialIdentityFromCallbackService(
                'discord',
                callback('discord'),
                checks,
            ),
        ).toEqual({
            provider: 'discord',
            subject: 'provider-subject',
            email: 'member@example.test',
            emailVerified: true,
        })
        providerPayload = {
            id: 'provider-subject',
            email: 'invalid',
            verified: true,
        }
        expect(
            await getSocialIdentityFromCallbackService(
                'discord',
                callback('discord'),
                checks,
            ),
        ).toEqual({
            provider: 'discord',
            subject: 'provider-subject',
            email: null,
            emailVerified: false,
        })
    })

    it('only lists fully configured providers and rejects partial configurations', () => {
        expect(getConfiguredSocialProvidersService()).toEqual([
            { id: 'google', name: 'Google' },
        ])
        process.env.OAUTH_GITHUB_CLIENT_ID = 'missing-secret'
        expect(() => parseSocialAuthEnvironmentService()).toThrow()
    })

    it.each(['apple', 'facebook', 'microsoft'] as const)(
        'rejects removed provider %s before profile or token requests',
        async (provider) => {
            expect(() =>
                getSocialProviderService(provider as SocialProviderId),
            ).toThrow('Unbekannter')
            await expect(
                getSocialIdentityFromCallbackService(
                    provider as SocialProviderId,
                    new URL(
                        `https://market.example.test/api/auth/${provider}/callback`,
                    ),
                    checks,
                ),
            ).rejects.toThrow('Unbekannter')
            expect(fetchMock).not.toHaveBeenCalled()
        },
    )

    it('fails closed for unconfigured providers', async () => {
        await expect(
            getSocialClientConfigurationService('discord'),
        ).rejects.toThrow()
    })
})
