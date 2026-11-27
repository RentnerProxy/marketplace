import { z } from 'zod'
import {
    appId,
    appVersion,
    displayName,
    formatVersion,
    packagePath,
    protocolRange,
    recordId,
    runtimeProfile,
    sourceIdentity,
    stateVersion,
    summary,
    target,
} from './primitives.ts'

const capabilities = [
    ['proxy.hosts.read.v1', 'proxyHosts'],
    ['proxy.hosts.manage-owned.v1', 'ownedProxyHosts'],
    ['diagnostics.upstream.probe.v1', 'proxyHosts'],
    ['diagnostics.upstream.probe.v2', 'proxyHosts'],
    ['notifications.publish.v1', 'installation'],
    ['notifications.incidents.manage.v1', 'installation'],
    ['docker.inventory.observe.v1', 'dockerConnections'],
    ['dns.challenge.manage.v1', 'dnsZones'],
    ['engine.contributions.submit.v1', 'ownedEngineResources'],
    ['identity.provider.register.v1', 'identityProviders'],
    ['access.logs.read.v1', 'proxyHosts'],
    ['security.enforcement.contribute.v1', 'ownedEngineResources'],
] as const

export const capabilityRequest = z
    .union(
        capabilities.map(([id, scope]) =>
            z.strictObject({
                id: z.literal(id),
                scope: z.literal(scope),
            }),
        ),
    )
    .describe(
        'Requested resource scope type. Grants and resource IDs are assigned by the local administrator.',
    )

export const providerProfile = z.enum([
    'monitoring',
    'docker-discovery',
    'load-balancer',
    'dns',
    'oidc',
    'crowdsec',
])

const requirements = z.strictObject({
    runtimeProfile,
    platformApi: protocolRange,
    appProtocol: protocolRange,
    uiBridge: protocolRange.optional(),
    engineCapabilities: z
        .array(z.enum(['caddy.load-balancing.v1', 'caddy.crowdsec.v1']))
        .max(2),
})

const ui = z.strictObject({
    entrypoint: packagePath('ui', 'html'),
    slots: z
        .array(
            z.enum(['navigation', 'proxyHostTab', 'dashboardWidget', 'search']),
        )
        .max(4),
})

const data = z
    .strictObject({
        targetVersion: stateVersion,
        readVersions: z.array(stateVersion).min(1).max(64),
        writeVersions: z.array(stateVersion).min(1).max(64),
        migrations: z
            .array(
                z.strictObject({
                    fromVersion: z.number().int().min(0).max(2_147_483_646),
                    toVersion: stateVersion,
                    path: packagePath('migrations', 'sql|json'),
                }),
            )
            .max(64),
    })
    .describe(
        'Write versions must be readable and include the target version. Order migrations by source version. Every declared forward migration must lead to the target, with one outgoing step per source version. Zero denotes fresh state.',
    )

export const appManifest = z
    .strictObject({
        formatVersion,
        id: appId,
        version: appVersion,
        target,
        source: sourceIdentity,
        display: z.strictObject({
            name: displayName,
            summary,
            license: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.+-]{0,63}$/),
        }),
        requires: requirements,
        entrypoint: z.literal('bin/app'),
        api: z.literal('api/openapi.json'),
        configSchema: packagePath('schemas', 'json').optional(),
        ui: ui.optional(),
        providers: z.array(providerProfile).max(6),
        capabilities: z.array(capabilityRequest).max(capabilities.length),
        permissions: z
            .array(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/))
            .max(64)
            .describe(
                'App-owned permission keys. The platform qualifies keys with the app ID.',
            ),
        data: data.optional(),
        incidentCategories: z
            .array(
                z.strictObject({
                    id: recordId.describe(
                        'App-local category ID. Keep it stable across releases: subscriptions refer to it together with the app ID.',
                    ),
                    name: z
                        .string()
                        .regex(/^[^\p{Cc}\p{Cs}\p{Cf}\p{Zl}\p{Zp}]{1,80}$/u)
                        .describe(
                            'Name users see when they subscribe and in notifications: one line of plain text without format characters.',
                        ),
                    resource: z
                        .enum(['proxyHost', 'none'])
                        .describe(
                            'What each incident of the category refers to. A proxyHost incident names a host the app may read or probe, and only users who may view that host receive it.',
                        ),
                }),
            )
            .min(1)
            .max(16)
            .optional()
            .describe(
                'Incident categories the app opens with notifications.incidents.manage.v1. Users subscribe to each category. The SDK checks unique IDs, and that the categories and the capability are declared together.',
            ),
        resources: z.strictObject({
            startupTimeoutMs: z.number().int().min(100).max(120_000),
            drainTimeoutMs: z.number().int().min(100).max(120_000),
            memoryMiB: z.number().int().min(16).max(16_384),
            processLimit: z.number().int().min(1).max(64),
        }),
    })
    .describe(
        'app.json inside a self-contained tar.zst. Omitted optional blocks are absent, never null. Runtime compatibility, safe extraction, and signed approval are independent checks.',
    )
