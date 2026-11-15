import { createHash } from 'node:crypto'
import type { LoginAttempt } from '@/server/RateLimit/Types/login-attempt.types.ts'
import type {
    LoginAttemptTestAccount,
    LoginAttemptTestModel,
    LoginAttemptTestReply,
} from './login-attempt.test.types.ts'

export const TEST_NOW = 1_800_000_000_000
export const TEST_LEASE = 30_000
export const TEST_HISTORY = 86_400_000
export const TEST_RETENTION = TEST_HISTORY + TEST_LEASE
const DURATIONS = [30, 180, 900]

export function accountPrefix(username: string) {
    return (
        'rentnerproxy-marketplace:rate-limit:login:' +
        createHash('sha256').update(username.trim()).digest('hex')
    )
}
export function canonicalId(value: string) {
    return (
        /^[A-Za-z0-9_-]{43}$/.test(value) &&
        Buffer.from(value, 'base64url').toString('base64url') === value
    )
}
export function fixedId(byte: number) {
    return Buffer.alloc(32, byte).toString('base64url')
}
export function modelAccount(model: LoginAttemptTestModel, username: string) {
    const key = accountPrefix(username)
    let account = model.accounts.get(key)
    if (!account) {
        account = {
            history: null,
            lock: null,
            generation: null,
            generationExpiresAt: null,
            inflight: new Map(),
            inflightExpiresAt: null,
        }
        model.accounts.set(key, account)
    }
    return account
}
function expireKeys(
    model: LoginAttemptTestModel,
    account: LoginAttemptTestAccount,
) {
    if (
        account.history?.expiresAt !== null &&
        account.history &&
        account.history.expiresAt <= model.now
    )
        account.history = null
    if (
        account.lock?.expiresAt !== null &&
        account.lock &&
        account.lock.expiresAt <= model.now
    )
        account.lock = null
    if (
        account.generationExpiresAt !== null &&
        account.generationExpiresAt <= model.now
    ) {
        account.generation = null
        account.generationExpiresAt = null
    }
    if (
        account.inflightExpiresAt !== null &&
        account.inflightExpiresAt <= model.now
    ) {
        account.inflight.clear()
        account.inflightExpiresAt = null
    }
}
function validateAccount(
    model: LoginAttemptTestModel,
    account: LoginAttemptTestAccount,
) {
    if (
        account.history &&
        (!Number.isInteger(account.history.failures) ||
            account.history.failures < 0 ||
            account.history.failures > 2 ||
            !Number.isInteger(account.history.stage) ||
            account.history.stage < 0 ||
            account.history.stage > 3 ||
            account.history.expiresAt === null ||
            account.history.expiresAt - model.now > TEST_HISTORY)
    )
        throw new Error('Invalid login attempt state')
    if (
        account.generation &&
        (!canonicalId(account.generation) ||
            account.generationExpiresAt === null ||
            account.generationExpiresAt - model.now > TEST_RETENTION)
    )
        throw new Error('Invalid login attempt generation')
    if (
        account.inflight.size &&
        (!account.generation ||
            account.inflightExpiresAt === null ||
            account.inflightExpiresAt - model.now > TEST_RETENTION)
    )
        throw new Error('Invalid login attempt inflight state')
}
function slotKey(attempt: LoginAttempt) {
    return attempt.generation + ':' + attempt.attemptId
}
function removeSlot(account: LoginAttemptTestAccount, attempt: LoginAttempt) {
    account.inflight.delete(slotKey(attempt))
    if (!account.inflight.size) account.inflightExpiresAt = null
}
function lockTtl(
    model: LoginAttemptTestModel,
    account: LoginAttemptTestAccount,
) {
    if (!account.lock) return 0
    return account.lock.expiresAt === null
        ? 1000
        : Math.max(1, account.lock.expiresAt - model.now)
}
function reply(
    status: string,
    ttl = 0,
    created = false,
): LoginAttemptTestReply {
    return [status, '', '', 0, ttl, created ? 1 : 0]
}
function rotate(
    model: LoginAttemptTestModel,
    account: LoginAttemptTestAccount,
    nextGeneration: string,
) {
    account.generation = nextGeneration
    account.generationExpiresAt = model.now + TEST_RETENTION
}
function charge(
    model: LoginAttemptTestModel,
    account: LoginAttemptTestAccount,
    count: number,
    nextGeneration: string,
) {
    if (!count || account.lock) return false
    const history = account.history ?? {
        failures: 0,
        stage: 0,
        expiresAt: null,
    }
    history.failures += count
    history.expiresAt = model.now + TEST_HISTORY
    account.history = history
    if (history.failures < 3) return false
    history.stage = Math.min(3, history.stage + 1)
    history.failures = 0
    account.lock = {
        expiresAt: model.now + DURATIONS[history.stage - 1] * 1000,
    }
    rotate(model, account, nextGeneration)
    return true
}
function reap(
    model: LoginAttemptTestModel,
    account: LoginAttemptTestAccount,
    nextGeneration: string,
) {
    let failures = 0
    for (const attempt of account.inflight.values()) {
        if (attempt.expiresAtMs > model.now) continue
        if (attempt.generation === account.generation) failures++
        removeSlot(account, attempt)
    }
    return charge(model, account, failures, nextGeneration)
}

export function evaluateLoginAttemptModel(
    model: LoginAttemptTestModel,
    keyCount: number,
    values: Array<string>,
): LoginAttemptTestReply {
    const [
        stateKey,
        lockKey,
        generationKey,
        inflightKey,
        operation,
        attemptId,
        expectedGeneration,
        outcome,
        nextGeneration,
        lease,
        maximum,
        firstLock,
        secondLock,
        thirdLock,
        historyTtl,
        retention,
        expectedDeadline,
    ] = values
    const prefix = stateKey.slice(0, -':state'.length)
    if (
        keyCount !== 4 ||
        stateKey !== prefix + ':state' ||
        lockKey !== prefix + ':lock' ||
        generationKey !== prefix + ':generation' ||
        inflightKey !== prefix + ':inflight'
    )
        throw new Error('Unexpected login attempt key boundary')
    if (
        [
            lease,
            maximum,
            firstLock,
            secondLock,
            thirdLock,
            historyTtl,
            retention,
        ].join('|') !== '30000|3|30|180|900|86400|86430000'
    )
        throw new Error('Unexpected login attempt policy boundary')
    let account = model.accounts.get(prefix)
    if (!account) {
        account = {
            history: null,
            lock: null,
            generation: null,
            generationExpiresAt: null,
            inflight: new Map(),
            inflightExpiresAt: null,
        }
        model.accounts.set(prefix, account)
    }
    expireKeys(model, account)
    validateAccount(model, account)
    const attempt: LoginAttempt = {
        generation: expectedGeneration,
        attemptId,
        expiresAtMs: Number(expectedDeadline),
    }
    const own = account.inflight.get(slotKey(attempt))
    const ownsSlot = own && own.expiresAtMs === attempt.expiresAtMs
    if (account.lock) {
        if (operation === 'finish' && ownsSlot) removeSlot(account, attempt)
        return reply(
            operation === 'reserve'
                ? 'locked'
                : operation === 'finish'
                  ? 'stale'
                  : 'recorded',
            lockTtl(model, account),
        )
    }
    if (
        operation === 'finish' &&
        (!ownsSlot || expectedGeneration !== account.generation)
    ) {
        if (ownsSlot) removeSlot(account, attempt)
        return reply('stale')
    }
    const retried =
        operation === 'reserve'
            ? Array.from(account.inflight.values()).find(function (entry) {
                  return entry.attemptId === attemptId
              })
            : undefined
    if (retried && retried.expiresAtMs > model.now)
        return [
            'reserved',
            retried.generation,
            retried.attemptId,
            retried.expiresAtMs,
            0,
            0,
        ]
    const expiredRetry = retried !== undefined
    const reapedLock = reap(model, account, nextGeneration)
    if (account.lock) {
        if (operation === 'finish' && ownsSlot) removeSlot(account, attempt)
        return reply(
            operation === 'reserve'
                ? 'locked'
                : operation === 'finish'
                  ? 'stale'
                  : 'recorded',
            lockTtl(model, account),
            reapedLock,
        )
    }
    if (operation === 'recovery-failure') {
        const created = charge(model, account, 1, nextGeneration)
        return reply('recorded', lockTtl(model, account), created)
    }
    if (operation === 'finish') {
        if (!account.inflight.has(slotKey(attempt))) return reply('stale')
        removeSlot(account, attempt)
        if (outcome === 'success') {
            account.history = null
            rotate(model, account, nextGeneration)
        } else if (outcome === 'failure') {
            const created = charge(model, account, 1, nextGeneration)
            return reply('applied', lockTtl(model, account), created)
        }
        return reply('applied')
    }
    if (operation !== 'reserve') throw new Error('Unexpected operation')
    if (expiredRetry) return reply('busy', 1)
    if ((account.history?.failures ?? 0) + account.inflight.size >= 3) {
        const remaining = Math.min(
            ...Array.from(account.inflight.values()).map(function (entry) {
                return entry.expiresAtMs - model.now
            }),
        )
        return reply('busy', Math.max(1, remaining))
    }
    if (!account.generation) rotate(model, account, nextGeneration)
    const reserved = {
        generation: account.generation!,
        attemptId,
        expiresAtMs: model.now + Number(lease),
    }
    account.inflight.set(slotKey(reserved), reserved)
    account.generationExpiresAt = model.now + Number(retention)
    account.inflightExpiresAt = model.now + Number(retention)
    return [
        'reserved',
        reserved.generation,
        attemptId,
        reserved.expiresAtMs,
        0,
        0,
    ]
}
