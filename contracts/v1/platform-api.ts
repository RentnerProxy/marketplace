import { z } from 'zod'
import { providerProfile } from './manifest.ts'
import { displayName, recordId, sha256, summary } from './primitives.ts'

const hostname = z
    .string()
    .max(253)
    .regex(
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    )
    .describe(
        'Lowercase ASCII hostname. Encode international names as A-labels.',
    )

const listCursor = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/)
const listedDomain = z
    .string()
    .max(255)
    .regex(
        /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    )
    .describe(
        'Lowercase ASCII domain, optionally with a leading wildcard label.',
    )
const proxyHost = z.looseObject({
    id: recordId,
    revision: recordId,
    hostname,
    enabled: z
        .boolean()
        .optional()
        .describe(
            'Whether the host serves traffic. Platforms that serve diagnostics.upstream.probe.v2 always include it.',
        ),
    domains: z
        .array(listedDomain)
        .min(1)
        .optional()
        .describe(
            'Every domain of the host in ascending order. Platforms that serve diagnostics.upstream.probe.v2 always include it; a probe names one of these domains that is not a wildcard.',
        ),
    probeRevision: sha256
        .optional()
        .describe(
            'Changes only when something an upstream probe observes changes. Platforms that serve diagnostics.upstream.probe.v2 always include it, and each probe result carries the value from when the probe ran.',
        ),
})

const upstreamAddress = z.union([z.ipv4(), z.ipv6(), hostname])

const maxUpstreamProbes = 32
const probedHost = {
    hostId: recordId.describe('Host ID from the proxy host listing.'),
    domain: hostname.describe(
        'One of the listed domains of the host, sent to the upstream like a request for that domain. Wildcard domains cannot be probed.',
    ),
}
const upstreamProbeTarget = z.strictObject({
    ...probedHost,
    timeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(8_000)
        .describe(
            'Upstream deadline in milliseconds. It leaves room for the platform checks within the App API request deadline.',
        ),
})
const upstreamProbeFailure = z
    .discriminatedUnion('stage', [
        z.looseObject({
            stage: z.literal('configuration'),
            code: z.enum([
                'configuration_stale',
                'configuration_changed',
                'host_not_active',
                'runtime_unavailable',
            ]),
        }),
        z.looseObject({
            stage: z.literal('tls'),
            code: z.literal('tls_failed'),
        }),
        z.looseObject({
            stage: z.literal('upstream'),
            code: z.enum([
                'upstream_unreachable',
                'upstream_timeout',
                'upstream_dns_failed',
                'upstream_responded',
                'access_denied',
                'upstream_error',
                'redirect_not_followed',
                'unexpected_status',
                'redirect_host',
                'wildcard_domain',
                'skipped',
            ]),
        }),
    ])
    .describe(
        'The first stage that prevented a usable upstream response, checked in this order: the active proxy configuration did not serve the host and domain, upstream TLS verification failed, or the upstream sent no HTTP response. Built-in monitoring reports configuration failures as unknown, tls_failed and the upstream codes upstream_unreachable, upstream_timeout and upstream_dns_failed as unhealthy, and any other upstream code as an invalid response.',
    )
const upstreamProbeOutcome = z
    .discriminatedUnion('outcome', [
        z.looseObject({
            outcome: z.literal('probed'),
            ...probedHost,
            probeRevision: sha256.describe(
                'Equals the probeRevision of the host in the listing when the probe ran. A different value means that something the probe observes changed since the host was listed.',
            ),
            durationMs: z
                .number()
                .int()
                .min(0)
                .max(12_000)
                .describe('Duration of the upstream stage.'),
            httpStatus: z
                .number()
                .int()
                .min(100)
                .max(599)
                .nullable()
                .describe(
                    'Status of the upstream response, or null without one. Compare it with the expected status only when failure is null. Built-in monitoring accepts exactly the expected status, and any 2xx or 3xx status while the expected status is the default 200.',
                ),
            failure: upstreamProbeFailure.nullable(),
        }),
        z.looseObject({
            outcome: z
                .enum([
                    'scopeDenied',
                    'hostRemoved',
                    'hostDisabled',
                    'domainNotFound',
                    'configurationChanged',
                    'busy',
                    'rateLimited',
                    'unavailable',
                ])
                .describe(
                    'The probe did not run or its result was discarded. scopeDenied: the grant no longer covers the host. hostRemoved, hostDisabled and domainNotFound: list the hosts again. configurationChanged: the host or proxy configuration changed during the probe; discard it. busy: monitoring-class capacity is in use or a probe of the same host is running. rateLimited: this installation exhausted its probe budget. unavailable: the proxy runtime cannot run probes. Retry busy, rateLimited and unavailable later with backoff.',
                ),
            ...probedHost,
        }),
    ])
    .describe('The result of one probe.')

const notification = z.strictObject({
    category: recordId,
    severity: z.enum(['info', 'warning', 'error']),
    title: displayName,
    message: summary,
})

/** A link-like run that a mail client could turn into a link, after ASCII-only lowercasing. */
const linkLike = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)/u
/** Lowercase ASCII letters only, as the Rust SDK does, so both SDKs fold case alike. */
function asciiLowercase(value: string) {
    return value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase())
}
/**
 * Plain incident text on one line: no control, surrogate, format, line or paragraph separator
 * characters, and no links.
 */
function incidentText(maximum: number) {
    return z
        .string()
        .regex(
            new RegExp(
                `^[^\\p{Cc}\\p{Cs}\\p{Cf}\\p{Zl}\\p{Zp}]{1,${maximum}}$`,
                'u',
            ),
        )
        .refine(
            (value) => !linkLike.test(asciiLowercase(value)),
            'Incident text cannot contain links.',
        )
}
const appIncidentChange = z
    .discriminatedUnion('status', [
        z.strictObject({
            status: z.literal('open'),
            category: recordId.describe(
                'An incident category the manifest declares.',
            ),
            severity: z.enum(['warning', 'error', 'critical']),
            title: incidentText(80),
            message: incidentText(400),
            resourceId: recordId
                .optional()
                .describe(
                    'Required for a proxyHost category and absent otherwise: the listed host ID the incident refers to. The app must hold a read or probe grant that covers the host.',
                ),
        }),
        z.strictObject({ status: z.literal('resolved') }),
    ])
    .describe(
        "Assert the current state of the incident the path key names. Open creates or updates it and resolve closes it. The SDK rejects link-like text. The platform renders title and message as plain text in its own templates, delivers through mail and webhook channels to users who subscribe to the category and may see the resource, and never sends a notification twice for a repeated state. Send the current state again with every observation: while notifications are paused after a restore, the platform keeps no incidents. Derive the idempotency key from the incident key and the asserted state, so a repeated observation reuses it and stays within the platform's idempotency record limit.",
    )

export const jsonValue = z.json()

const maxLegacyHandoffParts = 1_024
const maxLegacyHandoffPartBytes = 262_144
const utf8 = new TextEncoder()
const legacyHandoffDomain = providerProfile.describe(
    'Built-in feature domain that an official app takes over. It equals a provider profile. The app manifest must declare that profile, and the installation must hold the platform grant to register a provider for it.',
)
const legacyHandoffDigest = sha256.describe(
    'Opaque lowercase hexadecimal SHA-256 of the fixed export. It binds the domain and the ordered part hashes. Pass it unchanged to every part read and to commit.',
)
const legacyHandoffSequence = z
    .number()
    .int()
    .min(0)
    .max(maxLegacyHandoffParts - 1)
    .describe(
        'Zero-based position of a part in the fixed export. Valid sequences satisfy 0 <= sequence < partCount.',
    )
const platformOwned = z.strictObject({
    domain: legacyHandoffDomain,
    state: z.literal('platform'),
})
const exported = z.strictObject({
    domain: legacyHandoffDomain,
    state: z.literal('exported'),
    digest: legacyHandoffDigest,
    partCount: z
        .number()
        .int()
        .min(0)
        .max(maxLegacyHandoffParts)
        .describe('Number of parts in the fixed export.'),
})
const committed = z.strictObject({
    domain: legacyHandoffDomain,
    state: z.literal('committed'),
    digest: legacyHandoffDigest,
})

const legacyHandoffSchemas = {
    LegacyHandoffDomain: legacyHandoffDomain,
    LegacyHandoffStatus: z
        .discriminatedUnion('state', [platformOwned, exported, committed])
        .describe(
            'Ownership of the domain as seen by the active generation of the calling installation. platform means the platform still owns it. exported means this installation is importing the fixed export. committed means this installation owns it. Another holder is a conflict, never a state.',
        ),
    LegacyHandoffBeginResult: z
        .discriminatedUnion('state', [exported, committed])
        .describe(
            'exported carries the fixed export that this installation imports. committed means this installation already owns the domain and carries the committed digest without a part count.',
        ),
    LegacyHandoffPartRequest: z
        .strictObject({
            digest: legacyHandoffDigest,
            sequence: legacyHandoffSequence,
        })
        .describe(
            'Read one part of the export that begin fixed for this installation. The digest binds the read to that export. A read of a replaced export with a different digest fails and returns no part.',
        ),
    LegacyHandoffPart: z
        .strictObject({ sequence: legacyHandoffSequence, part: jsonValue })
        .refine(
            ({ part }) =>
                utf8.encode(JSON.stringify(part)).byteLength <=
                maxLegacyHandoffPartBytes,
            'The serialized part exceeds the size limit.',
        )
        .describe(
            'One exported part as App API wire JSON. The SDK checks that the compact JSON.stringify form of part is at most 262144 UTF-8 bytes. Import it durably before commit.',
        ),
    LegacyHandoffCommit: z
        .strictObject({ digest: legacyHandoffDigest })
        .describe(
            'Commit exactly the digest that begin returned after every part is imported durably. The platform retires its state once.',
        ),
    LegacyHandoffCommitResult: committed.describe(
        'This installation owns the domain. A repeated commit with the same digest returns the same result.',
    ),
}

export const appApiPayload = z
    .record(z.string(), jsonValue)
    .describe(
        'A bounded JSON object. The gateway and app validate its content against the installed operation schema.',
    )

export const platformApiSchemas = {
    AppApiPayload: appApiPayload,
    ProxyHostQuery: z.strictObject({
        limit: z.number().int().min(1).max(100),
        cursor: listCursor.optional(),
    }),
    ProxyHostPage: z.looseObject({
        hosts: z.array(proxyHost).max(100),
        nextCursor: listCursor.optional(),
    }),
    OwnedProxyHostChange: z.discriminatedUnion('action', [
        z.strictObject({
            action: z.literal('upsert'),
            hostId: recordId,
            expectedRevision: recordId
                .nullable()
                .describe('Null requires that the host does not yet exist.'),
            hostname,
            upstream: z.strictObject({
                scheme: z.enum(['http', 'https']),
                address: upstreamAddress,
                port: z.number().int().min(1).max(65_535),
            }),
        }),
        z.strictObject({
            action: z.literal('remove'),
            hostId: recordId,
            expectedRevision: recordId,
        }),
    ]),
    UpstreamProbe: z.strictObject({
        hostId: recordId,
        timeoutMs: z.number().int().min(1).max(10_000),
    }),
    UpstreamProbeResult: z.discriminatedUnion('outcome', [
        z.looseObject({
            outcome: z.literal('reachable'),
            durationMs: z.number().int().min(0).max(10_000),
        }),
        z.looseObject({ outcome: z.enum(['unreachable', 'timedOut']) }),
    ]),
    UpstreamProbeBatch: z
        .strictObject({
            probes: z
                .array(upstreamProbeTarget)
                .min(1)
                .max(maxUpstreamProbes)
                .refine(
                    (probes) =>
                        new Set(probes.map(({ hostId }) => hostId)).size ===
                        probes.length,
                    'Probe each host at most once per batch.',
                ),
        })
        .describe(
            'Probe hosts that a diagnostics.upstream.probe.v2 grant covers, each through the domain the app chooses from the listing. The SDK checks that each host appears once. The platform admits every probe with monitoring-class capacity separate from interactive Domain Checks, against a budget of this installation sized for 1,000 hosts probed every 60 seconds.',
        ),
    UpstreamProbeOutcome: upstreamProbeOutcome,
    UpstreamProbeBatchResult: z
        .looseObject({
            results: z
                .array(upstreamProbeOutcome)
                .min(1)
                .max(maxUpstreamProbes),
        })
        .describe('One result for every requested probe, in request order.'),
    AppNotification: notification,
    AppIncidentChange: appIncidentChange,
    AppAuditEvent: z.strictObject({
        action: recordId,
        outcome: z.enum(['succeeded', 'rejected', 'failed']),
        resourceId: recordId.optional(),
    }),
    AppSecret: z
        .strictObject({
            value: z.string().min(1).max(16_384),
        })
        .describe(
            'Return only to the authorized backend. Keep secret values out of logs and browser messages.',
        ),
    ...legacyHandoffSchemas,
}
