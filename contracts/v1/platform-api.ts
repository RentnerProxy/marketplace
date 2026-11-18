import { z } from 'zod'
import { displayName, recordId, summary } from './primitives.ts'

const hostname = z
    .string()
    .max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .describe('Lowercase ASCII hostname. Encode international names as A-labels.')

const listCursor = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/)
const proxyHost = z.looseObject({
    id: recordId,
    revision: recordId,
    hostname,
})

const upstreamAddress = z.union([z.ipv4(), z.ipv6(), hostname])
const notification = z.strictObject({
    category: recordId,
    severity: z.enum(['info', 'warning', 'error']),
    title: displayName,
    message: summary,
})

export const jsonValue = z.json()
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
            expectedRevision: recordId.nullable().describe('Null requires that the host does not yet exist.'),
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
    AppNotification: notification,
    AppAuditEvent: z.strictObject({
        action: recordId,
        outcome: z.enum(['succeeded', 'rejected', 'failed']),
        resourceId: recordId.optional(),
    }),
    AppSecret: z.strictObject({
        value: z.string().min(1).max(16_384),
    }).describe('Return only to the authorized backend. Keep secret values out of logs and browser messages.'),
}
