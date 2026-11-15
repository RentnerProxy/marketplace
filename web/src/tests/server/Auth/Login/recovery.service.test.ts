import {
    RESERVE_ATTEMPT_SCRIPT,
    CLAIM_ATTEMPT_SCRIPT,
} from '@/server/Auth/Login/recovery.script.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
    claimLoginRecoveryAttemptService,
    issueLoginRecoveryGrantService,
    reserveLoginRecoveryAttemptService,
} from '@/server/Auth/Login/recovery.service.ts'
import { LOGIN_RECOVERY_POLICY } from '@/config/security.config.ts'
import { LOGIN_RECOVERY_COOKIE_NAME } from '@/config/session.config.ts'
import type {
    LoginRecoveryAttempt,
    LoginRecoveryUser,
} from '@/server/Auth/Types/login-recovery.types.ts'
import type {
    RecoveryTestCookieOptions,
    RecoveryTestIssuedGrant,
    RecoveryTestReservedGrant,
    RecoveryTestState,
} from './recovery.service.test.types.ts'

const NOW = 1_800_000_000_000
const TTL = 300_000
const PREFIX = 'rentnerproxy-marketplace:login-recovery:v1:'
const USER: LoginRecoveryUser = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'Recovery.Test.User',
    passwordHash: 'synthetic-password-hash-v1',
}
const ISSUE = {
    userId: USER.id,
    username: USER.username,
    passwordHash: USER.passwordHash,
}
const LOCK_KEY = 'rentnerproxy-marketplace:login-lock:unrelated-account'
const savedNodeEnv = process.env.NODE_ENV

function sha256(value: string) {
    return createHash('sha256').update(value).digest('hex')
}
function usernameHash(username = USER.username) {
    return sha256(JSON.stringify(['login-recovery-username-v1', username]))
}
function passwordVersion(user = USER) {
    return sha256(
        JSON.stringify([
            'login-recovery-password-v1',
            user.id,
            user.passwordHash,
        ]),
    )
}
function canonicalToken(value: string) {
    const bytes = Buffer.from(value, 'base64url')
    return (
        /^[A-Za-z0-9_-]{43}$/.test(value) &&
        bytes.byteLength === 32 &&
        bytes.toString('base64url') === value
    )
}
function fixedToken(byte: number) {
    return Buffer.alloc(32, byte).toString('base64url')
}
const grantSchema = z.strictObject({
    purpose: z.literal('login-recovery-v1'),
    userId: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[A-Za-z0-9_-]+$/),
    usernameHash: z.string().regex(/^[a-f0-9]{64}$/),
    passwordVersion: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    attemptIds: z.array(z.string().refine(canonicalToken)).max(3),
})
const state: RecoveryTestState = {
    now: NOW,
    entries: new Map(),
    cookies: new Map(),
    events: [],
    connectionError: null,
    setError: null,
    evalError: null,
    deleteError: null,
    cookieError: null,
    deleteCookieError: null,
    collision: false,
    pttlOverride: null,
    evalOverride: null,
}

function readModelGrant(key: string, maximumTtl: number) {
    const entry = state.entries.get(key)
    if (!entry) return null
    const ttl =
        state.pttlOverride ??
        (entry.expiresAt === null ? -1 : entry.expiresAt - state.now)
    if (
        ttl <= 0 ||
        ttl > maximumTtl ||
        entry.kind !== 'string' ||
        Buffer.byteLength(entry.value) > 2048
    )
        return null
    let value: unknown
    try {
        value = JSON.parse(entry.value)
    } catch {
        return null
    }
    const parsed = grantSchema.safeParse(value)
    if (!parsed.success || parsed.data.expiresAt <= state.now) return null
    if (new Set(parsed.data.attemptIds).size !== parsed.data.attemptIds.length)
        return null
    return { entry, grant: parsed.data }
}

function evaluateModel(
    script: string,
    keyCount: number,
    key: string,
    args: Array<string>,
) {
    if (keyCount !== 1 || !key.startsWith(PREFIX))
        throw new Error('Unexpected Valkey key boundary')
    if (script === RESERVE_ATTEMPT_SCRIPT) {
        if (args.length !== 4) throw new Error('Unexpected reserve arguments')
        const [username, attempt, maximum, ttl] = args
        const stored = readModelGrant(key, Number(ttl))
        if (
            !stored ||
            stored.grant.usernameHash !== username ||
            !canonicalToken(attempt) ||
            stored.grant.attemptIds.length >= Number(maximum) ||
            stored.grant.attemptIds.includes(attempt)
        )
            return 0
        stored.grant.attemptIds.push(attempt)
        stored.entry.value = JSON.stringify(stored.grant)
        return 1
    }
    if (script === CLAIM_ATTEMPT_SCRIPT) {
        if (args.length !== 6) throw new Error('Unexpected claim arguments')
        const [attempt, userId, username, version, maximum, ttl] = args
        const stored = readModelGrant(key, Number(ttl))
        if (
            !stored ||
            Number(maximum) !== 3 ||
            !canonicalToken(attempt) ||
            stored.grant.userId !== userId ||
            stored.grant.usernameHash !== username ||
            stored.grant.passwordVersion !== version ||
            !stored.grant.attemptIds.includes(attempt)
        )
            return 0
        state.entries.delete(key)
        return 1
    }
    throw new Error('Unexpected recovery script')
}
const valkey = {
    set: vi.fn(async function (
        key: string,
        value: string,
        mode: string,
        ttl: number,
        condition: string,
    ) {
        state.events.push('valkey:set:start')
        if (state.setError) throw state.setError
        if (mode !== 'PX' || condition !== 'NX')
            throw new Error('Expected SET NX PX')
        if (state.collision)
            state.entries.set(key, {
                value: 'existing-colliding-grant',
                expiresAt: state.now + 1000,
                kind: 'string',
            })
        const existing = state.entries.get(key)
        if (
            existing &&
            (existing.expiresAt === null || existing.expiresAt > state.now)
        )
            return null
        state.entries.set(key, {
            value,
            expiresAt: state.now + ttl,
            kind: 'string',
        })
        state.events.push('valkey:set:committed')
        return 'OK'
    }),
    eval: vi.fn(async function (
        script: string,
        keyCount: number,
        key: string,
        ...args: Array<string>
    ): Promise<unknown> {
        state.events.push('valkey:eval')
        if (state.evalError) throw state.evalError
        if (state.evalOverride) return state.evalOverride.value
        return evaluateModel(script, keyCount, key, args)
    }),
    del: vi.fn(async function (key: string) {
        state.events.push('valkey:del')
        if (state.deleteError) throw state.deleteError
        return state.entries.delete(key) ? 1 : 0
    }),
}
const getValkeyConnection = vi.fn(function () {
    if (state.connectionError) throw state.connectionError
    return valkey
})
const getCookie = vi.fn(function (name: string) {
    return state.cookies.get(name)
})
const setCookie = vi.fn(function (
    name: string,
    value: string,
    _options: RecoveryTestCookieOptions,
) {
    state.events.push('cookie:set')
    if (state.cookieError) throw state.cookieError
    state.cookies.set(name, value)
})
const deleteCookie = vi.fn(function (name: string, _options: { path: string }) {
    state.events.push('cookie:delete')
    if (state.deleteCookieError) throw state.deleteCookieError
    state.cookies.delete(name)
})
vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return { getValkeyConnection }
})
vi.mock('@tanstack/react-start/server', function () {
    return { getCookie, setCookie, deleteCookie }
})

async function issueGrant(input = ISSUE): Promise<RecoveryTestIssuedGrant> {
    await issueLoginRecoveryGrantService(input)
    const token = state.cookies.get(LOGIN_RECOVERY_COOKIE_NAME)
    if (!token) throw new Error('Missing issued cookie')
    const key = PREFIX + sha256(token)
    const entry = state.entries.get(key)
    if (!entry) throw new Error('Missing issued record')
    return {
        key,
        token,
        entry,
        grant: grantSchema.parse(JSON.parse(entry.value)),
    }
}
async function reserveGrant(): Promise<RecoveryTestReservedGrant> {
    const issued = await issueGrant()
    const attempt = await reserveLoginRecoveryAttemptService(USER.username)
    if (!attempt) throw new Error('Missing reservation')
    return { ...issued, attempt }
}
function readGrant(key: string) {
    const entry = state.entries.get(key)
    if (!entry) throw new Error('Missing stored grant')
    return grantSchema.parse(JSON.parse(entry.value))
}

beforeEach(function () {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockImplementation(function () {
        return state.now
    })
    state.now = NOW
    state.entries.clear()
    state.entries.set(LOCK_KEY, {
        value: 'normal-account-lock',
        expiresAt: null,
        kind: 'string',
    })
    state.cookies.clear()
    state.cookies.set('unrelated-cookie', 'unrelated-value')
    state.events = []
    state.connectionError = null
    state.setError = null
    state.evalError = null
    state.deleteError = null
    state.cookieError = null
    state.deleteCookieError = null
    state.collision = false
    state.pttlOverride = null
    state.evalOverride = null
    process.env.NODE_ENV = 'test'
})
afterEach(function () {
    expect(state.entries.get(LOCK_KEY)?.value).toBe('normal-account-lock')
    expect(state.cookies.get('unrelated-cookie')).toBe('unrelated-value')
    vi.restoreAllMocks()
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = savedNodeEnv
})

describe('recovery issuance', function () {
    it('persists only token/username/password hashes with purpose, identity and fixed expiry', async function () {
        const issued = await issueGrant()
        expect(LOGIN_RECOVERY_POLICY).toEqual({
            durationMs: TTL,
            maximumAttempts: 3,
        })
        expect(canonicalToken(issued.token)).toBe(true)
        expect(issued.key).toBe(PREFIX + sha256(issued.token))
        expect(issued.grant).toEqual({
            purpose: 'login-recovery-v1',
            userId: USER.id,
            usernameHash: usernameHash(),
            passwordVersion: passwordVersion(),
            expiresAt: NOW + TTL,
            attemptIds: [],
        })
        expect(issued.entry.expiresAt).toBe(NOW + TTL)
        for (const secret of [issued.token, USER.username, USER.passwordHash])
            expect(issued.entry.value).not.toContain(secret)
        expect(valkey.set).toHaveBeenCalledWith(
            issued.key,
            issued.entry.value,
            'PX',
            TTL,
            'NX',
        )
        expect(setCookie).toHaveBeenCalledWith(
            LOGIN_RECOVERY_COOKIE_NAME,
            issued.token,
            {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                path: '/',
                expires: new Date(NOW + TTL),
                maxAge: TTL / 1000,
            },
        )
        expect(state.events).toEqual([
            'valkey:set:start',
            'valkey:set:committed',
            'cookie:set',
        ])
    })

    it('uses secure production cookies and independent tokens', async function () {
        process.env.NODE_ENV = 'production'
        const first = await issueGrant()
        const second = await issueGrant()
        expect(first.token).not.toBe(second.token)
        expect(first.key).not.toBe(second.key)
        expect(setCookie.mock.calls[0][2].secure).toBe(true)
        expect(setCookie.mock.calls[1][2].secure).toBe(true)
    })

    it.each([{ userId: '' }, { username: ' ' }, { passwordHash: '' }])(
        'rejects malformed issue input before Valkey: %j',
        async function (changes) {
            await expect(
                issueLoginRecoveryGrantService({ ...ISSUE, ...changes }),
            ).rejects.toThrow()
            expect(getValkeyConnection).not.toHaveBeenCalled()
            expect(setCookie).not.toHaveBeenCalled()
        },
    )

    it.each(['connection', 'set'])(
        'propagates %s failures without setting cookies or deleting records',
        async function (boundary) {
            const error = new Error('synthetic issue failure')
            if (boundary === 'connection') state.connectionError = error
            else state.setError = error
            await expect(issueLoginRecoveryGrantService(ISSUE)).rejects.toThrow(
                'synthetic issue failure',
            )
            expect(setCookie).not.toHaveBeenCalled()
            expect(valkey.del).not.toHaveBeenCalled()
        },
    )

    it('preserves an existing record when SET NX rejects a token collision', async function () {
        state.collision = true
        await expect(issueLoginRecoveryGrantService(ISSUE)).rejects.toThrow(
            'Login recovery grant could not be created',
        )
        const attemptedKey = valkey.set.mock.calls[0][0]
        expect(state.entries.get(attemptedKey)?.value).toBe(
            'existing-colliding-grant',
        )
        expect(setCookie).not.toHaveBeenCalled()
        expect(valkey.del).not.toHaveBeenCalled()
    })

    it('cleans up only the freshly created grant if setCookie fails', async function () {
        const existing = await issueGrant()
        state.cookieError = new Error('synthetic cookie failure')
        await expect(issueLoginRecoveryGrantService(ISSUE)).rejects.toThrow(
            'synthetic cookie failure',
        )
        const failedKey = valkey.set.mock.calls[1][0]
        expect(failedKey).not.toBe(existing.key)
        expect(valkey.del).toHaveBeenCalledTimes(1)
        expect(valkey.del).toHaveBeenCalledWith(failedKey)
        expect(state.entries.has(failedKey)).toBe(false)
        expect(state.entries.has(existing.key)).toBe(true)
        expect(state.cookies.get(LOGIN_RECOVERY_COOKIE_NAME)).toBe(
            existing.token,
        )
        expect(deleteCookie).not.toHaveBeenCalled()
    })

    it('propagates a cleanup failure and never deletes another grant', async function () {
        const existing = await issueGrant()
        state.cookieError = new Error('synthetic cookie failure')
        state.deleteError = new Error('synthetic cleanup failure')
        await expect(issueLoginRecoveryGrantService(ISSUE)).rejects.toThrow(
            'synthetic cleanup failure',
        )
        expect(valkey.del).toHaveBeenCalledTimes(1)
        expect(valkey.del.mock.calls[0][0]).not.toBe(existing.key)
        expect(state.entries.has(existing.key)).toBe(true)
        expect(state.cookies.get(LOGIN_RECOVERY_COOKIE_NAME)).toBe(
            existing.token,
        )
    })
})

describe('recovery reservation', function () {
    it('checks the normalized, case-sensitive username before spending an attempt', async function () {
        const issued = await issueGrant({
            ...ISSUE,
            username: '  ' + USER.username + ' ',
        })
        expect(
            await reserveLoginRecoveryAttemptService(
                USER.username.toLowerCase(),
            ),
        ).toBeNull()
        expect(readGrant(issued.key).attemptIds).toEqual([])
        const attempt = await reserveLoginRecoveryAttemptService(
            '  ' + USER.username + '  ',
        )
        if (!attempt) throw new Error('Expected reservation')
        expect(canonicalToken(attempt.attemptId)).toBe(true)
        expect(attempt.grantTokenHash).toBe(sha256(issued.token))
        expect(Object.keys(attempt).toSorted()).toEqual([
            'attemptId',
            'grantTokenHash',
        ])
        expect(readGrant(issued.key).attemptIds).toEqual([attempt.attemptId])
    })

    it.each([
        undefined,
        '',
        'A'.repeat(42),
        'A'.repeat(44),
        'A'.repeat(42) + '=',
        'A'.repeat(42) + 'B',
    ])(
        'rejects missing or noncanonical cookies before Valkey: %s',
        async function (cookie) {
            if (cookie !== undefined)
                state.cookies.set(LOGIN_RECOVERY_COOKIE_NAME, cookie)
            expect(
                await reserveLoginRecoveryAttemptService(USER.username),
            ).toBeNull()
            expect(getValkeyConnection).not.toHaveBeenCalled()
        },
    )

    it('rejects an unknown token and invalid username without creating grants', async function () {
        state.cookies.set(LOGIN_RECOVERY_COOKIE_NAME, fixedToken(1))
        expect(await reserveLoginRecoveryAttemptService(' ')).toBeNull()
        expect(getValkeyConnection).not.toHaveBeenCalled()
        expect(
            await reserveLoginRecoveryAttemptService(USER.username),
        ).toBeNull()
        expect(state.entries.size).toBe(1)
        expect(deleteCookie).not.toHaveBeenCalled()
    })

    it('allows only three parallel reservations and keeps the last one claimable', async function () {
        const issued = await issueGrant()
        const results = await Promise.all(
            Array.from({ length: 20 }, function () {
                return reserveLoginRecoveryAttemptService(USER.username)
            }),
        )
        const accepted = results.filter(
            function (attempt): attempt is LoginRecoveryAttempt {
                return attempt !== null
            },
        )
        expect(accepted).toHaveLength(3)
        expect(
            new Set(
                accepted.map(function (attempt) {
                    return attempt.attemptId
                }),
            ).size,
        ).toBe(3)
        expect(readGrant(issued.key).attemptIds).toHaveLength(3)
        expect(issued.entry.expiresAt).toBe(NOW + TTL)
        expect(await claimLoginRecoveryAttemptService(accepted[2], USER)).toBe(
            true,
        )
        expect(state.entries.has(issued.key)).toBe(false)
    })

    it('retains both expiry deadlines after reservation and a denied claim', async function () {
        const reserved = await reserveGrant()
        state.now += 100_000
        expect(
            await reserveLoginRecoveryAttemptService(USER.username),
        ).not.toBeNull()
        state.now += 100_000
        expect(
            await claimLoginRecoveryAttemptService(reserved.attempt, {
                ...USER,
                passwordHash: 'changed-password-hash',
            }),
        ).toBe(false)
        expect(reserved.entry.expiresAt).toBe(NOW + TTL)
        expect(readGrant(reserved.key).expiresAt).toBe(NOW + TTL)
        state.now = NOW + TTL
        expect(
            await reserveLoginRecoveryAttemptService(USER.username),
        ).toBeNull()
        expect(
            await claimLoginRecoveryAttemptService(reserved.attempt, USER),
        ).toBe(false)
        expect(deleteCookie).not.toHaveBeenCalled()
    })
})

describe('recovery claim', function () {
    it('allows one concurrent claim across all three admitted attempts', async function () {
        const issued = await issueGrant()
        const attempts = await Promise.all(
            [1, 2, 3].map(function () {
                return reserveLoginRecoveryAttemptService(USER.username)
            }),
        )
        const results = await Promise.all(
            Array.from({ length: 30 }, function (_, index) {
                const attempt = attempts[index % 3]
                if (!attempt) throw new Error('Missing expected reservation')
                return claimLoginRecoveryAttemptService(attempt, USER)
            }),
        )
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(state.entries.has(issued.key)).toBe(false)
        expect(deleteCookie).toHaveBeenCalledTimes(1)
        expect(deleteCookie).toHaveBeenCalledWith(LOGIN_RECOVERY_COOKIE_NAME, {
            path: '/',
        })
    })

    it.each([
        { id: '00000000-0000-4000-8000-000000000002' },
        { username: 'another-user' },
        { passwordHash: 'synthetic-password-hash-after-reset' },
    ])(
        'checks every account/password binding without consuming a mismatched grant: %j',
        async function (changes) {
            const reserved = await reserveGrant()
            const before = reserved.entry.value
            expect(
                await claimLoginRecoveryAttemptService(reserved.attempt, {
                    ...USER,
                    ...changes,
                }),
            ).toBe(false)
            expect(reserved.entry.value).toBe(before)
            expect(deleteCookie).not.toHaveBeenCalled()
            expect(state.cookies.get(LOGIN_RECOVERY_COOKIE_NAME)).toBe(
                reserved.token,
            )
            expect(
                await claimLoginRecoveryAttemptService(reserved.attempt, USER),
            ).toBe(true)
            expect(
                await claimLoginRecoveryAttemptService(reserved.attempt, USER),
            ).toBe(false)
        },
    )

    it('accepts a verified snapshot with extra fields and normalized username', async function () {
        const reserved = await reserveGrant()
        const user = {
            ...USER,
            username: '  ' + USER.username + ' ',
            isActive: true,
        }
        expect(
            await claimLoginRecoveryAttemptService(reserved.attempt, user),
        ).toBe(true)
    })

    it('rejects unreserved IDs and attempts belonging to another grant', async function () {
        const first = await reserveGrant()
        const second = await reserveGrant()
        expect(
            await claimLoginRecoveryAttemptService(
                { ...first.attempt, attemptId: fixedToken(9) },
                USER,
            ),
        ).toBe(false)
        expect(
            await claimLoginRecoveryAttemptService(
                {
                    ...first.attempt,
                    grantTokenHash: second.attempt.grantTokenHash,
                },
                USER,
            ),
        ).toBe(false)
        expect(state.entries.has(first.key)).toBe(true)
        expect(state.entries.has(second.key)).toBe(true)
        expect(deleteCookie).not.toHaveBeenCalled()
    })

    it.each([
        { grantTokenHash: 'A'.repeat(64) },
        { grantTokenHash: 'a'.repeat(63) },
        { attemptId: 'A'.repeat(42) + 'B' },
        { attemptId: '' },
        { extra: 'unexpected' },
    ])(
        'rejects malformed attempt input before Valkey: %j',
        async function (changes) {
            const attempt = {
                grantTokenHash: 'a'.repeat(64),
                attemptId: fixedToken(1),
                ...changes,
            }
            expect(await claimLoginRecoveryAttemptService(attempt, USER)).toBe(
                false,
            )
            expect(getValkeyConnection).not.toHaveBeenCalled()
            expect(deleteCookie).not.toHaveBeenCalled()
        },
    )

    it('propagates cookie deletion failure after consumption without allowing replay', async function () {
        const reserved = await reserveGrant()
        state.deleteCookieError = new Error('synthetic cookie delete failure')
        await expect(
            claimLoginRecoveryAttemptService(reserved.attempt, USER),
        ).rejects.toThrow('synthetic cookie delete failure')
        expect(state.entries.has(reserved.key)).toBe(false)
        expect(
            await claimLoginRecoveryAttemptService(reserved.attempt, USER),
        ).toBe(false)
        expect(deleteCookie).toHaveBeenCalledTimes(1)
    })
})

describe('recovery invalid state and Valkey failures', function () {
    it.each([-2, -1, 0, TTL + 1])(
        'rejects PTTL %i for both reservation and claim',
        async function (ttl) {
            const reserved = await reserveGrant()
            state.pttlOverride = ttl
            expect(
                await reserveLoginRecoveryAttemptService(USER.username),
            ).toBeNull()
            expect(
                await claimLoginRecoveryAttemptService(reserved.attempt, USER),
            ).toBe(false)
            expect(deleteCookie).not.toHaveBeenCalled()
        },
    )

    it('rejects a persistent key and a past absolute deadline independently', async function () {
        const reserved = await reserveGrant()
        reserved.entry.expiresAt = null
        expect(
            await reserveLoginRecoveryAttemptService(USER.username),
        ).toBeNull()
        expect(
            await claimLoginRecoveryAttemptService(reserved.attempt, USER),
        ).toBe(false)
        state.now += TTL
        reserved.entry.expiresAt = state.now + 10_000
        expect(
            await reserveLoginRecoveryAttemptService(USER.username),
        ).toBeNull()
        expect(
            await claimLoginRecoveryAttemptService(reserved.attempt, USER),
        ).toBe(false)
        expect(deleteCookie).not.toHaveBeenCalled()
    })

    it.each([
        'absent',
        'wrong Valkey type',
        'broken JSON',
        'wrong purpose',
        'unknown field',
        'object attempts',
        'duplicate attempts',
    ])('rejects invalid stored state: %s', async function (kind) {
        const reserved = await reserveGrant()
        const grant = readGrant(reserved.key)
        if (kind === 'absent') state.entries.delete(reserved.key)
        else if (kind === 'wrong Valkey type') reserved.entry.kind = 'hash'
        else if (kind === 'broken JSON') reserved.entry.value = '{'
        else if (kind === 'wrong purpose')
            reserved.entry.value = JSON.stringify({
                ...grant,
                purpose: 'password-reset-v1',
            })
        else if (kind === 'unknown field')
            reserved.entry.value = JSON.stringify({
                ...grant,
                unexpected: true,
            })
        else if (kind === 'object attempts')
            reserved.entry.value = JSON.stringify({ ...grant, attemptIds: {} })
        else
            reserved.entry.value = JSON.stringify({
                ...grant,
                attemptIds: [
                    reserved.attempt.attemptId,
                    reserved.attempt.attemptId,
                ],
            })
        expect(
            await reserveLoginRecoveryAttemptService(USER.username),
        ).toBeNull()
        expect(
            await claimLoginRecoveryAttemptService(reserved.attempt, USER),
        ).toBe(false)
        expect(deleteCookie).not.toHaveBeenCalled()
    })

    it.each(['connection', 'eval'])(
        'propagates %s failures from reservation and claim',
        async function (boundary) {
            const reserved = await reserveGrant()
            const error = new Error('synthetic recovery unavailable')
            if (boundary === 'connection') state.connectionError = error
            else state.evalError = error
            await expect(
                reserveLoginRecoveryAttemptService(USER.username),
            ).rejects.toThrow('synthetic recovery unavailable')
            await expect(
                claimLoginRecoveryAttemptService(reserved.attempt, USER),
            ).rejects.toThrow('synthetic recovery unavailable')
            expect(state.entries.has(reserved.key)).toBe(true)
            expect(deleteCookie).not.toHaveBeenCalled()
        },
    )

    it.each(
        [null, undefined, '1', true, 2, -1, [], {}].map(function (value) {
            return { value }
        }),
    )('rejects unexpected Valkey response %j', async function ({ value }) {
        const reserved = await reserveGrant()
        state.evalOverride = { value }
        await expect(
            reserveLoginRecoveryAttemptService(USER.username),
        ).rejects.toThrow('Unexpected login recovery response')
        await expect(
            claimLoginRecoveryAttemptService(reserved.attempt, USER),
        ).rejects.toThrow('Unexpected login recovery response')
        expect(deleteCookie).not.toHaveBeenCalled()
    })

    it('passes exact hashed bindings to one-key Lua commands with TTL-preserving reservation writes', async function () {
        const reserved = await reserveGrant()
        const reserveCall = valkey.eval.mock.calls[0]
        expect(reserveCall.slice(1)).toEqual([
            1,
            reserved.key,
            usernameHash(),
            reserved.attempt.attemptId,
            '3',
            String(TTL),
        ])
        expect(
            await claimLoginRecoveryAttemptService(reserved.attempt, USER),
        ).toBe(true)
        const claimCall = valkey.eval.mock.calls[1]
        expect(claimCall.slice(1)).toEqual([
            1,
            reserved.key,
            reserved.attempt.attemptId,
            USER.id,
            usernameHash(),
            passwordVersion(),
            '3',
            String(TTL),
        ])
        for (const script of [reserveCall[0], claimCall[0]]) {
            expect(script).toContain("server.call('PTTL', key)")
            expect(script).toContain("server.call('TYPE', key)")
            expect(script).toContain("server.call('TIME')")
            expect(script).toContain('grant.expiresAt <= now')
            expect(script).not.toMatch(
                /server\.call\('(?:P?EXPIRE|P?EXPIREAT)'/,
            )
        }
        expect(reserveCall[0]).toContain(
            "server.call('SET', KEYS[1], cjson.encode(grant), 'XX', 'KEEPTTL')",
        )
        expect(claimCall[0]).toContain("return server.call('DEL', KEYS[1])")
        expect(valkey.del).not.toHaveBeenCalled()
    })
})
