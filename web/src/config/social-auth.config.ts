export const SOCIAL_AUTH_POLICY = {
    challengeDurationMs: 10 * 60_000,
    secondFactorDurationMs: 5 * 60_000,
    requestTimeoutSeconds: 15,
    maximumCallbackBytes: 16_384,
} as const

export const SOCIAL_PROVIDERS = [
    {
        id: 'google',
        name: 'Google',
        scopes: 'openid email',
        issuer: 'https://accounts.google.com',
        authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        jwks: 'https://www.googleapis.com/oauth2/v3/certs',
        pkce: true,
    },
    {
        id: 'github',
        name: 'GitHub',
        scopes: 'read:user user:email',
        issuer: 'https://github.com',
        authorization: 'https://github.com/login/oauth/authorize',
        token: 'https://github.com/login/oauth/access_token',
        jwks: null,
        pkce: true,
    },
    {
        id: 'discord',
        name: 'Discord',
        scopes: 'identify email',
        issuer: 'https://discord.com',
        authorization: 'https://discord.com/oauth2/authorize',
        token: 'https://discord.com/api/oauth2/token',
        jwks: null,
        pkce: true,
    },
] as const
