import { createTokenHashSync } from '@/lib/Auth/tokens.ts'
import { getClientIp } from '@/lib/Request/clientRequestMeta.ts'
import { defineValkeyScript } from '@/server/Valkey/valkey-script.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import { z } from 'zod'

import type { RateLimitOptions } from './Types/rate-limit.types.ts'

const rateLimitResultSchema = z.tuple([
    z.number().int().positive(),
    z.number().int(),
])

const incrementRateLimit = defineValkeyScript(
    'tdIncrementRateLimit',
    1,
    `
local count = server.call('INCR', KEYS[1])
if count == 1 then
    server.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = server.call('PTTL', KEYS[1])
return { count, ttl }
`,
)

function formatRetryDuration(seconds: number) {
    if (seconds < 60) {
        return `${seconds} ${seconds === 1 ? 'Sekunde' : 'Sekunden'}`
    }

    const minutes = Math.ceil(seconds / 60)
    return `${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`
}

export class RateLimitError extends Error {
    readonly retryAfterSeconds: number

    constructor(retryAfterSeconds: number) {
        super(
            `Zu viele Anfragen. Du kannst es in ${formatRetryDuration(retryAfterSeconds)} erneut versuchen.`,
        )
        this.name = 'RateLimitError'
        this.retryAfterSeconds = retryAfterSeconds
    }
}

function getRateLimitIdentityHash(
    identifiers: Array<string | null | undefined>,
    includeClientIp: boolean,
) {
    const identity = [
        ...(includeClientIp ? [getClientIp() ?? 'unknown'] : []),
        ...identifiers,
    ]
        .filter((value): value is string => Boolean(value?.trim()))
        .join('|')
    return createTokenHashSync(identity || 'unknown')
}

export async function enforceRateLimit({
    scope,
    identifiers = [],
    includeClientIp = true,
    limit,
    windowMs,
}: RateLimitOptions) {
    const identityHash = getRateLimitIdentityHash(identifiers, includeClientIp)
    const key = `rentnerproxy-marketplace:rate-limit:${scope}:${identityHash}`
    const valkey = getValkeyConnection()
    const result = await incrementRateLimit(valkey, key, String(windowMs))
    const [count, ttl] = rateLimitResultSchema.parse(result)

    if (count > limit) {
        throw new RateLimitError(Math.max(1, Math.ceil(ttl / 1000)))
    }
}
