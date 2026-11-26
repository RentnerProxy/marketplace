import { z } from 'zod'
import {
    socialAuthEnvironmentSchema,
    socialAuthEnvironmentFields,
} from './social-auth-environment.service.ts'
import { containerLogReaderOriginSchema } from '@/server/Logging/container-log.validation.ts'
import {
    parseConfiguredRealtimeWebSocketUrlService,
    resolveRealtimeWebSocketOriginService,
} from './realtime-environment.service.ts'
import {
    isLoopbackOriginService,
    parseTrustedProxyRanges,
} from '@/server/Request/trustedProxy.service.ts'
import {
    backupEnvironmentSchema,
    resolveBackupRuntimeEnvironment,
} from './backup-environment.service.ts'
import {
    createUrlSchema,
    normalizeOptionalEnvironmentValue,
    optionalEnvironmentValue,
} from './environment-schema.service.ts'

const originSchema = createUrlSchema('ORIGIN', ['http:', 'https:']).superRefine(
    function (value, context) {
        try {
            const url = new URL(value)

            if (
                value !== url.origin ||
                url.username !== '' ||
                url.password !== ''
            ) {
                context.addIssue({
                    code: 'custom',
                    message:
                        'ORIGIN muss eine exakte http(s)-Origin ohne Pfad, abschließenden Slash, Query, Fragment oder Zugangsdaten sein.',
                })
            }

            if (url.protocol !== 'https:' && !isLoopbackOriginService(url)) {
                context.addIssue({
                    code: 'custom',
                    message:
                        'ORIGIN muss in Produktion HTTPS verwenden; HTTP ist nur für Loopback erlaubt.',
                })
            }
        } catch {
            return
        }
    },
)

function parseExactSecurePasskeyOrigin(value: string) {
    try {
        const url = new URL(value)
        const usesAllowedProtocol =
            url.protocol === 'https:' ||
            (url.protocol === 'http:' && isLoopbackOriginService(url))

        if (value !== url.origin || !usesAllowedProtocol) {
            return null
        }

        return url
    } catch {
        return null
    }
}

const appEnvironmentSchema = backupEnvironmentSchema
    .extend({
        ...socialAuthEnvironmentFields,
        ORIGIN: originSchema,
        CONTAINER_LOG_READER_URL: z.preprocess(
            normalizeOptionalEnvironmentValue,
            containerLogReaderOriginSchema.optional(),
        ),
        VITE_REALTIME_WS_URL: z
            .unknown()
            .transform(function (value, context) {
                try {
                    return parseConfiguredRealtimeWebSocketUrlService(value)
                } catch (error) {
                    context.addIssue({
                        code: 'custom',
                        message:
                            error instanceof Error
                                ? error.message
                                : 'VITE_REALTIME_WS_URL ist ungültig.',
                    })
                    return z.NEVER
                }
            })
            .optional(),
        TRUST_PROXY_HEADERS: z.enum(['true', 'false']).default('false'),
        TRUSTED_PROXY_RANGES: optionalEnvironmentValue,
        PASSKEY_ORIGIN: optionalEnvironmentValue,
        PASSKEY_RP_ID: optionalEnvironmentValue,
        PASSKEY_RP_NAME: optionalEnvironmentValue,
    })
    .superRefine(function (environment, context) {
        const socialEnvironment =
            socialAuthEnvironmentSchema.safeParse(environment)
        if (!socialEnvironment.success) {
            for (const issue of socialEnvironment.error.issues) {
                context.addIssue({
                    code: 'custom',
                    path: issue.path,
                    message: issue.message,
                })
            }
        }
        try {
            resolveRealtimeWebSocketOriginService({
                origin: environment.ORIGIN,
                configuredUrl: environment.VITE_REALTIME_WS_URL,
            })
        } catch (error) {
            context.addIssue({
                code: 'custom',
                path: [
                    environment.VITE_REALTIME_WS_URL
                        ? 'VITE_REALTIME_WS_URL'
                        : 'ORIGIN',
                ],
                message:
                    error instanceof Error
                        ? error.message
                        : 'Die Realtime-Konfiguration ist ungültig.',
            })
        }

        const passkeyOrigin = environment.PASSKEY_ORIGIN ?? environment.ORIGIN
        const passkeyUrl = parseExactSecurePasskeyOrigin(passkeyOrigin)

        if (!passkeyUrl) {
            context.addIssue({
                code: 'custom',
                path: ['PASSKEY_ORIGIN'],
                message:
                    'PASSKEY_ORIGIN muss eine exakte sichere Origin ohne Pfad, Query oder Fragment sein.',
            })
        } else {
            const rpId = environment.PASSKEY_RP_ID?.toLowerCase()

            if (
                rpId &&
                passkeyUrl.hostname !== rpId &&
                !passkeyUrl.hostname.endsWith(`.${rpId}`)
            ) {
                context.addIssue({
                    code: 'custom',
                    path: ['PASSKEY_RP_ID'],
                    message:
                        'PASSKEY_RP_ID muss dem Passkey-Origin-Host oder einer übergeordneten Domain entsprechen.',
                })
            }
        }

        if (environment.TRUST_PROXY_HEADERS !== 'true') {
            if (environment.TRUSTED_PROXY_RANGES) {
                context.addIssue({
                    code: 'custom',
                    path: ['TRUSTED_PROXY_RANGES'],
                    message:
                        'TRUSTED_PROXY_RANGES darf nicht bei deaktivierten Proxy-Headern gesetzt sein.',
                })
            }
            return
        }

        if (!environment.TRUSTED_PROXY_RANGES) {
            context.addIssue({
                code: 'custom',
                path: ['TRUSTED_PROXY_RANGES'],
                message:
                    'TRUSTED_PROXY_RANGES wird benötigt, wenn TRUST_PROXY_HEADERS=true ist.',
            })
            return
        }

        try {
            parseTrustedProxyRanges(environment.TRUSTED_PROXY_RANGES)
        } catch (error) {
            context.addIssue({
                code: 'custom',
                path: ['TRUSTED_PROXY_RANGES'],
                message:
                    error instanceof Error
                        ? error.message
                        : 'TRUSTED_PROXY_RANGES ist ungültig.',
            })
        }
    })

const resolvedAppEnvironmentSchema = z.preprocess(
    resolveBackupRuntimeEnvironment,
    appEnvironmentSchema,
)

export function parseAppProductionEnvironment(environment: unknown) {
    return resolvedAppEnvironmentSchema.parse(environment)
}
