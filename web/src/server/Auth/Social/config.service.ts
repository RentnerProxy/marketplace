import {
    Configuration,
    ClientSecretPost,
    enableNonRepudiationChecks,
} from 'openid-client'
import {
    SOCIAL_AUTH_POLICY,
    SOCIAL_PROVIDERS,
} from '@/config/social-auth.config.ts'
import { parseSocialAuthEnvironmentService } from '@/server/Runtime/social-auth-environment.service.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'

export function getSocialProviderService(provider: SocialProviderId) {
    const definition = SOCIAL_PROVIDERS.find((entry) => entry.id === provider)
    if (!definition) throw new Error('Unbekannter Anmeldeanbieter.')
    return definition
}

function getProviderCredentialsService(provider: SocialProviderId) {
    const environment = parseSocialAuthEnvironmentService()
    switch (provider) {
        case 'google':
            return {
                clientId: environment.OAUTH_GOOGLE_CLIENT_ID,
                clientSecret: environment.OAUTH_GOOGLE_CLIENT_SECRET,
            }
        case 'github':
            return {
                clientId: environment.OAUTH_GITHUB_CLIENT_ID,
                clientSecret: environment.OAUTH_GITHUB_CLIENT_SECRET,
            }
        case 'discord':
            return {
                clientId: environment.OAUTH_DISCORD_CLIENT_ID,
                clientSecret: environment.OAUTH_DISCORD_CLIENT_SECRET,
            }
        default:
            throw new Error('Unbekannter Anmeldeanbieter.')
    }
}

export function getConfiguredSocialProvidersService() {
    return SOCIAL_PROVIDERS.filter(
        (provider) => getProviderCredentialsService(provider.id).clientId,
    ).map(({ id, name }) => ({ id, name }))
}

export function getSocialAuthOriginService() {
    const value = process.env.ORIGIN?.trim()
    if (!value)
        throw new Error('ORIGIN ist für Anbieter-Anmeldungen erforderlich.')
    const origin = new URL(value)
    if (
        value !== origin.origin ||
        origin.username ||
        origin.password ||
        (origin.protocol !== 'https:' &&
            !(
                origin.protocol === 'http:' &&
                ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
            ))
    ) {
        throw new Error('ORIGIN muss eine exakte sichere Origin sein.')
    }
    return origin
}

export function getSocialCallbackUrlService(provider: SocialProviderId) {
    return new URL(
        `/api/auth/${provider}/callback`,
        getSocialAuthOriginService(),
    ).href
}

export async function getSocialClientConfigurationService(
    provider: SocialProviderId,
) {
    const definition = getSocialProviderService(provider)
    const credentials = getProviderCredentialsService(provider)
    if (!credentials.clientId)
        throw new Error('Dieser Anmeldeanbieter ist nicht konfiguriert.')
    const secret = credentials.clientSecret
    const configuration = new Configuration(
        {
            issuer: definition.issuer,
            authorization_endpoint: definition.authorization,
            token_endpoint: definition.token,
            authorization_response_iss_parameter_supported:
                definition.authorizationResponseIssuer,
            ...(definition.jwks
                ? {
                      jwks_uri: definition.jwks,
                      id_token_signing_alg_values_supported: ['RS256'],
                  }
                : {}),
        },
        credentials.clientId,
        {
            client_secret: secret,
            ...(definition.jwks
                ? { id_token_signed_response_alg: 'RS256' }
                : {}),
        },
        ClientSecretPost(secret),
    )
    configuration.timeout = SOCIAL_AUTH_POLICY.requestTimeoutSeconds
    if (definition.jwks) enableNonRepudiationChecks(configuration)
    return configuration
}
