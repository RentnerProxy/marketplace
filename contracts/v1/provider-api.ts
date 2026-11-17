import { z } from 'zod'
import { providerProfile } from './manifest.ts'
import { recordId, timestamp } from './primitives.ts'
import { operation } from './wire.ts'

const providerRegistration = z.strictObject({
    id: recordId,
    profile: providerProfile,
    version: z.literal('1.0.0'),
})

const limit = z.number().int().min(1).max(100)
const address = z.union([z.ipv4(), z.ipv6()])
const port = z.number().int().min(1).max(65_535)
const revision = z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .describe(
        'Canonical positive decimal revision, ordered numerically within a contribution.',
    )
const challengeName = z
    .string()
    .max(253)
    .regex(
        /^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    )

const discoveryRequest = z
    .strictObject({ connectionId: recordId, limit })
    .describe(
        'The connection must be assigned to the installation by the platform.',
    )

const engineRequest = z.discriminatedUnion('action', [
    z.strictObject({
        action: z.literal('apply'),
        contributionId: recordId,
        revision,
        policy: z.enum(['roundRobin', 'leastConnections']),
        upstreams: z.array(z.strictObject({ address, port })).min(1).max(64),
    }),
    z.strictObject({
        action: z.literal('readStatus'),
        contributionId: recordId,
    }),
])

const dnsRequest = z.discriminatedUnion('action', [
    z.strictObject({
        action: z.literal('present'),
        challengeId: recordId,
        zoneId: recordId,
        name: challengeName,
        value: z.string().regex(/^[\x20-\x7e]{1,255}$/),
    }),
    z.strictObject({ action: z.literal('check'), challengeId: recordId }),
    z.strictObject({ action: z.literal('cleanup'), challengeId: recordId }),
])

const oidcRequest = z
    .strictObject({ transactionId: recordId })
    .describe(
        'Resolve only the platform-brokered transaction bound to this installation.',
    )

const crowdsecRequest = z.discriminatedUnion('action', [
    z.strictObject({
        action: z.literal('consumeLogs'),
        batchId: recordId,
        entries: z
            .array(
                z.strictObject({
                    proxyHostId: recordId,
                    observedAt: timestamp,
                    clientAddress: address,
                    status: z.number().int().min(100).max(599),
                }),
            )
            .min(1)
            .max(100)
            .describe(
                'Platform-projected access events for proxy hosts granted to this installation.',
            ),
    }),
    z.strictObject({
        action: z.literal('evaluate'),
        proxyHostId: recordId,
        clientAddress: address,
    }),
])

const providerRequest = z.discriminatedUnion('profile', [
    z.strictObject({
        profile: providerProfile.extract(['monitoring']),
        payload: z.strictObject({ limit }),
    }),
    z.strictObject({
        profile: providerProfile.extract(['docker-discovery']),
        payload: discoveryRequest,
    }),
    z.strictObject({
        profile: providerProfile.extract(['load-balancer']),
        payload: engineRequest,
    }),
    z.strictObject({
        profile: providerProfile.extract(['dns']),
        payload: dnsRequest,
    }),
    z.strictObject({
        profile: providerProfile.extract(['oidc']),
        payload: oidcRequest,
    }),
    z.strictObject({
        profile: providerProfile.extract(['crowdsec']),
        payload: crowdsecRequest,
    }),
])

const monitoringResult = z
    .looseObject({
        samples: z
            .array(
                z.looseObject({
                    serviceId: recordId,
                    observedAt: timestamp,
                    healthy: z.boolean(),
                }),
            )
            .max(100),
    })
    .describe('Read-only health samples up to the requested limit.')

const discoveryResult = z
    .looseObject({
        connectionId: recordId,
        observations: z
            .array(
                z.looseObject({
                    workloadId: recordId,
                    observedAt: timestamp,
                    address,
                    port,
                }),
            )
            .max(100),
    })
    .describe(
        'Observations apply only to records owned by this installation and connection.',
    )

const engineResult = z
    .looseObject({
        contributionId: recordId,
        revisionStatus: z.discriminatedUnion('status', [
            z.looseObject({
                status: z.literal('applied'),
                appliedRevision: revision,
            }),
            z.looseObject({
                status: z.enum(['unchanged', 'rejected', 'unavailable']),
                appliedRevision: revision.nullable(),
            }),
        ]),
    })
    .describe(
        'A stale, invalid, or unavailable update leaves the last applied revision intact.',
    )

const dnsResult = z
    .discriminatedUnion('action', [
        z.looseObject({
            action: z.enum(['present', 'cleanup']),
            challengeId: recordId,
            operation,
        }),
        z.looseObject({
            action: z.literal('check'),
            challengeId: recordId,
            outcome: z.enum(['verified', 'missing', 'unavailable']),
        }),
    ])
    .describe(
        'Presentation and cleanup are bound to an owned challenge. A failure preserves the serving certificate.',
    )

const identityValue = z.string().regex(/^[^\p{Cc}\p{Cs}]{1,255}$/u)
const oidcResult = z
    .discriminatedUnion('outcome', [
        z.looseObject({
            outcome: z.literal('verified'),
            transactionId: recordId,
            identity: z.looseObject({
                subject: identityValue,
                groups: z.array(identityValue).max(64),
            }),
        }),
        z.looseObject({
            outcome: z.enum(['invalid', 'unavailable']),
            transactionId: recordId,
        }),
    ])
    .describe(
        'The verified identity is a proposal. Session issuance and authorization stay with the platform.',
    )

const crowdsecResult = z.discriminatedUnion('action', [
    z.looseObject({
        action: z.literal('consumeLogs'),
        batchId: recordId,
        outcome: z.enum(['processed', 'unavailable']),
    }),
    z.looseObject({
        action: z.literal('evaluate'),
        decision: z
            .discriminatedUnion('outcome', [
                z.looseObject({
                    outcome: z.literal('allow'),
                    allowed: z.literal(true),
                    cachedBlock: z.literal(false),
                }),
                z.looseObject({
                    outcome: z.literal('deny'),
                    allowed: z.literal(false),
                    cachedBlock: z.literal(true),
                }),
                z.looseObject({
                    outcome: z.literal('unavailable'),
                    allowed: z.literal(false),
                    cachedBlock: z.boolean(),
                }),
            ])
            .describe(
                'Unavailability confirms no allow decision and preserves any cached block.',
            ),
    }),
])

const providerResult = z.discriminatedUnion('profile', [
    z.looseObject({
        profile: providerProfile.extract(['monitoring']),
        payload: monitoringResult,
    }),
    z.looseObject({
        profile: providerProfile.extract(['docker-discovery']),
        payload: discoveryResult,
    }),
    z.looseObject({
        profile: providerProfile.extract(['load-balancer']),
        payload: engineResult,
    }),
    z.looseObject({
        profile: providerProfile.extract(['dns']),
        payload: dnsResult,
    }),
    z.looseObject({
        profile: providerProfile.extract(['oidc']),
        payload: oidcResult,
    }),
    z.looseObject({
        profile: providerProfile.extract(['crowdsec']),
        payload: crowdsecResult,
    }),
])

export const providerSchemas = {
    ProviderRegistration: providerRegistration,
    ProviderRequest: providerRequest,
    ProviderResult: providerResult,
}
