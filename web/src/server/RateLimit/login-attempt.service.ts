import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { LOGIN_ATTEMPT_POLICY } from '@/config/security.config.ts'
import { createTokenHashSync } from '@/lib/Auth/tokens.ts'
import { defineValkeyScript } from '@/server/Valkey/valkey-script.ts'
import { getValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import { LOGIN_ATTEMPT_SCRIPT } from './login-attempt.script.ts'
import type {
    FinishLoginAttemptResult,
    LoginAttempt,
    LoginAttemptOperation,
    LoginAttemptOutcome,
    LoginFailureResult,
    ReserveLoginAttemptResult,
} from './Types/login-attempt.types.ts'

const tokenSchema = z
    .string()
    .length(43)
    .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
const integerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const attemptSchema = z.strictObject({
    generation: tokenSchema,
    attemptId: tokenSchema,
    expiresAtMs: integerSchema.positive(),
})
const usernameSchema = z.string().trim().min(1).max(50)
const outcomeSchema = z.enum(['success', 'failure', 'neutral'])
const maximumLockMs =
    Math.max(...LOGIN_ATTEMPT_POLICY.lockDurationsSeconds) * 1000
const lockDurationSchema = integerSchema.max(maximumLockMs)
const flagSchema = z.union([z.literal(0), z.literal(1)])
const updateLoginAttempt = defineValkeyScript(
    'tdUpdateLoginAttempt',
    4,
    LOGIN_ATTEMPT_SCRIPT,
)
const replySchema = z
    .union([
        z.tuple([
            z.literal('reserved'),
            tokenSchema,
            tokenSchema,
            integerSchema.positive(),
            z.literal(0),
            z.literal(0),
        ]),
        z.tuple([
            z.literal('locked'),
            z.literal(''),
            z.literal(''),
            z.literal(0),
            lockDurationSchema.positive(),
            flagSchema,
        ]),
        z.tuple([
            z.literal('busy'),
            z.literal(''),
            z.literal(''),
            z.literal(0),
            integerSchema.min(1).max(LOGIN_ATTEMPT_POLICY.leaseDurationMs),
            z.literal(0),
        ]),
        z.tuple([
            z.enum(['applied', 'stale', 'recorded']),
            z.literal(''),
            z.literal(''),
            z.literal(0),
            lockDurationSchema,
            flagSchema,
        ]),
    ])
    .refine(function (reply) {
        return reply[5] === 0 || reply[4] > 0
    })

async function runLoginAttempt(
    username: string,
    operation: LoginAttemptOperation,
    attempt?: LoginAttempt,
    outcome?: LoginAttemptOutcome,
) {
    const normalizedUsername = usernameSchema.safeParse(username)
    if (!normalizedUsername.success) {
        throw new Error('Invalid login attempt identity')
    }
    const identityHash = createTokenHashSync(normalizedUsername.data)
    const prefix = `rentnerproxy-marketplace:rate-limit:login:${identityHash}`
    const attemptId =
        operation === 'reserve'
            ? randomBytes(32).toString('base64url')
            : (attempt?.attemptId ?? '')
    const rawReply = await updateLoginAttempt(
        getValkeyConnection(),
        `${prefix}:state`,
        `${prefix}:lock`,
        `${prefix}:generation`,
        `${prefix}:inflight`,
        operation,
        attemptId,
        attempt?.generation ?? '',
        outcome ?? '',
        randomBytes(32).toString('base64url'),
        String(LOGIN_ATTEMPT_POLICY.leaseDurationMs),
        String(LOGIN_ATTEMPT_POLICY.maximumFailures),
        ...LOGIN_ATTEMPT_POLICY.lockDurationsSeconds.map(String),
        String(LOGIN_ATTEMPT_POLICY.historyTtlSeconds),
        String(LOGIN_ATTEMPT_POLICY.retentionMs),
        String(attempt?.expiresAtMs ?? 0),
    )
    const parsed = replySchema.safeParse(rawReply)
    if (!parsed.success) {
        throw new Error('Invalid login attempt response')
    }
    if (parsed.data[0] === 'reserved' && parsed.data[2] !== attemptId) {
        throw new Error('Invalid login attempt response')
    }
    return parsed.data
}

export async function reserveLoginAttemptService(
    username: string,
): Promise<ReserveLoginAttemptResult> {
    const reply = await runLoginAttempt(username, 'reserve')
    if (reply[0] === 'reserved') {
        return {
            allowed: true,
            attempt: {
                generation: reply[1],
                attemptId: reply[2],
                expiresAtMs: reply[3],
            },
        }
    }
    if (reply[0] !== 'locked' && reply[0] !== 'busy') {
        throw new Error('Invalid login attempt response')
    }
    return {
        allowed: false,
        reason: reply[0],
        retryAfterSeconds: Math.max(1, Math.ceil(reply[4] / 1000)),
        lockCreated: reply[5] === 1,
    }
}

export async function finishLoginAttemptService(
    username: string,
    attempt: LoginAttempt,
    outcome: LoginAttemptOutcome,
): Promise<FinishLoginAttemptResult> {
    const parsedAttempt = attemptSchema.safeParse(attempt)
    const parsedOutcome = outcomeSchema.safeParse(outcome)
    if (!parsedAttempt.success || !parsedOutcome.success) {
        throw new Error('Invalid login attempt completion')
    }
    const reply = await runLoginAttempt(
        username,
        'finish',
        parsedAttempt.data,
        parsedOutcome.data,
    )
    if (
        (reply[0] !== 'applied' && reply[0] !== 'stale') ||
        (reply[0] === 'applied' &&
            reply[4] > 0 &&
            (parsedOutcome.data !== 'failure' || reply[5] !== 1))
    ) {
        throw new Error('Invalid login attempt response')
    }
    return {
        applied: reply[0] === 'applied',
        lockCreated: reply[5] === 1,
        lockDurationSeconds: Math.ceil(reply[4] / 1000),
    }
}

export async function recordFailedLogin(
    username: string,
): Promise<LoginFailureResult> {
    const reply = await runLoginAttempt(username, 'recovery-failure')
    if (reply[0] !== 'recorded') {
        throw new Error('Invalid login attempt response')
    }
    return {
        lockCreated: reply[5] === 1,
        lockDurationSeconds: Math.ceil(reply[4] / 1000),
    }
}
