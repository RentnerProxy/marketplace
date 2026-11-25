import { LOGIN_ATTEMPT_SCRIPT } from '@/server/RateLimit/login-attempt.script.ts'
import { forEachSequentially } from '@/lib/Promise/forEachSequentially.ts'
import { mockValkeyDefineCommand } from '@/tests/shared/valkey-script.test.helpers.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    finishLoginAttemptService,
    recordFailedLogin,
    reserveLoginAttemptService,
} from '@/server/RateLimit/login-attempt.service.ts'
import {
    accountPrefix,
    canonicalId,
    evaluateLoginAttemptModel,
    fixedId,
    modelAccount,
    TEST_HISTORY,
    TEST_LEASE,
    TEST_NOW,
    TEST_RETENTION,
} from './login-attempt.test.helpers.ts'
import type { LoginAttemptTestModel } from './login-attempt.test.types.ts'

const USERNAME = 'Synthetic.Login.User'
const model: LoginAttemptTestModel = { now: TEST_NOW, accounts: new Map() }
const NO_OVERRIDE = Symbol('no-override')
let forcedReply: unknown = NO_OVERRIDE
let connectionError: Error | null = null
let evalError: Error | null = null
const getClientIp = vi.fn(function () {
    return '203.0.113.10'
})
const evalScript = vi.fn(async function (
    script: string,
    keyCount: number,
    ...values: Array<string>
): Promise<unknown> {
    if (evalError) throw evalError
    if (forcedReply !== NO_OVERRIDE) return forcedReply
    if (script !== LOGIN_ATTEMPT_SCRIPT)
        throw new Error('Unexpected login script boundary')
    return evaluateLoginAttemptModel(model, keyCount, values)
})
const valkey = {
    eval: evalScript,
    defineCommand: mockValkeyDefineCommand(evalScript),
}
const getValkeyConnection = vi.fn(function () {
    if (connectionError) throw connectionError
    return valkey
})
vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return { getValkeyConnection }
})
vi.mock('@/lib/Request/clientRequestMeta.ts', function () {
    return { getClientIp }
})

async function reserve(username = USERNAME) {
    const result = await reserveLoginAttemptService(username)
    if (!result.allowed) throw new Error('Expected admitted attempt')
    return result.attempt
}
function account(username = USERNAME) {
    return modelAccount(model, username)
}

beforeEach(function () {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockImplementation(function () {
        return model.now
    })
    model.now = TEST_NOW
    model.accounts.clear()
    forcedReply = NO_OVERRIDE
    connectionError = null
    evalError = null
    getClientIp.mockReturnValue('203.0.113.10')
})
afterEach(function () {
    vi.restoreAllMocks()
})

describe('atomic login admission model', function () {
    it('admits at most three concurrent requests for one account across client IPs', async function () {
        const results = await Promise.all(
            Array.from({ length: 20 }, function (_, index) {
                getClientIp.mockReturnValue('203.0.113.' + String(index + 1))
                return reserveLoginAttemptService(
                    index % 2 ? USERNAME : '  ' + USERNAME + '  ',
                )
            }),
        )
        const allowed = results.filter(function (result) {
            return result.allowed
        })
        expect(allowed).toHaveLength(3)
        expect(
            results.filter(function (result) {
                return !result.allowed
            }),
        ).toHaveLength(17)
        for (const result of results) {
            if (result.allowed) {
                expect(canonicalId(result.attempt.attemptId)).toBe(true)
                expect(canonicalId(result.attempt.generation)).toBe(true)
                expect(result.attempt.expiresAtMs).toBe(TEST_NOW + TEST_LEASE)
            } else
                expect(result).toEqual({
                    allowed: false,
                    reason: 'busy',
                    retryAfterSeconds: 30,
                    lockCreated: false,
                })
        }
        expect(account().inflight.size).toBe(3)
        expect(
            new Set(
                Array.from(account().inflight.values()).map(function (attempt) {
                    return attempt.attemptId
                }),
            ).size,
        ).toBe(3)
        expect(
            new Set(
                valkey.eval.mock.calls.map(function (call) {
                    return call[2]
                }),
            ).size,
        ).toBe(1)
        expect(valkey.eval.mock.calls[0][2]).not.toContain(USERNAME)
        expect(getClientIp).not.toHaveBeenCalled()
    })

    it('counts confirmed failures plus active slots and only refunds a neutral owner slot', async function () {
        const [first, second, third] = await Promise.all([
            reserve(),
            reserve(),
            reserve(),
        ])
        await finishLoginAttemptService(USERNAME, first, 'failure')
        await finishLoginAttemptService(USERNAME, second, 'failure')
        expect(account().history?.failures).toBe(2)
        expect(await reserveLoginAttemptService(USERNAME)).toMatchObject({
            allowed: false,
            reason: 'busy',
        })
        expect(
            await finishLoginAttemptService(USERNAME, third, 'neutral'),
        ).toEqual({ applied: true, lockCreated: false, lockDurationSeconds: 0 })
        const replacement = await reserve()
        expect(
            await finishLoginAttemptService(USERNAME, replacement, 'failure'),
        ).toEqual({ applied: true, lockCreated: true, lockDurationSeconds: 30 })
    })

    it('retains the 30/180/900-second escalation stages and caps subsequent locks', async function () {
        await forEachSequentially(
            [30, 180, 900, 900],
            async function (duration, index) {
                const attempts = await Promise.all([
                    reserve(),
                    reserve(),
                    reserve(),
                ])
                const finishes: Array<
                    Awaited<ReturnType<typeof finishLoginAttemptService>>
                > = []
                await forEachSequentially(attempts, async function (attempt) {
                    finishes.push(
                        await finishLoginAttemptService(
                            USERNAME,
                            attempt,
                            'failure',
                        ),
                    )
                })
                expect(
                    finishes.filter(function (result) {
                        return result.lockCreated
                    }),
                ).toHaveLength(1)
                expect(finishes[2]).toEqual({
                    applied: true,
                    lockCreated: true,
                    lockDurationSeconds: duration,
                })
                expect(account().history?.stage).toBe(Math.min(index + 1, 3))
                expect(account().history?.failures).toBe(0)
                expect(await reserveLoginAttemptService(USERNAME)).toEqual({
                    allowed: false,
                    reason: 'locked',
                    retryAfterSeconds: duration,
                    lockCreated: false,
                })
                model.now += duration * 1000 + 1
            },
        )
    })

    it('retains live foreign slots when current success clears failures and rotates generation', async function () {
        account().history = {
            failures: 1,
            stage: 2,
            expiresAt: model.now + TEST_HISTORY,
        }
        const [winner, foreign] = await Promise.all([reserve(), reserve()])
        expect(
            await finishLoginAttemptService(USERNAME, winner, 'success'),
        ).toEqual({ applied: true, lockCreated: false, lockDurationSeconds: 0 })
        expect(account().history).toBeNull()
        expect(account().generation).not.toBe(winner.generation)
        expect(account().inflight.size).toBe(1)
        const fresh = await Promise.all([reserve(), reserve()])
        expect(await reserveLoginAttemptService(USERNAME)).toMatchObject({
            allowed: false,
            reason: 'busy',
        })
        expect(
            await finishLoginAttemptService(USERNAME, foreign, 'failure'),
        ).toEqual({
            applied: false,
            lockCreated: false,
            lockDurationSeconds: 0,
        })
        expect(account().history).toBeNull()
        expect(account().inflight.size).toBe(2)
        expect(Array.from(account().inflight.values())).toEqual(
            expect.arrayContaining(fresh),
        )
    })

    it('does not charge old-generation orphans after a successful login', async function () {
        const [winner, old] = await Promise.all([reserve(), reserve()])
        await finishLoginAttemptService(USERNAME, winner, 'success')
        model.now += TEST_LEASE
        await reserve()
        expect(account().history).toBeNull()
        expect(account().inflight.size).toBe(1)
        expect(
            await finishLoginAttemptService(USERNAME, old, 'failure'),
        ).toMatchObject({ applied: false })
        expect(account().history).toBeNull()
    })

    it('charges current-generation 30-second orphans exactly once', async function () {
        const attempts = await Promise.all([reserve(), reserve(), reserve()])
        model.now += TEST_LEASE - 1
        expect(await reserveLoginAttemptService(USERNAME)).toEqual({
            allowed: false,
            reason: 'busy',
            retryAfterSeconds: 1,
            lockCreated: false,
        })
        model.now++
        expect(await reserveLoginAttemptService(USERNAME)).toEqual({
            allowed: false,
            reason: 'locked',
            retryAfterSeconds: 30,
            lockCreated: true,
        })
        expect(account().history?.stage).toBe(1)
        expect(account().inflight.size).toBe(0)
        expect(await reserveLoginAttemptService(USERNAME)).toMatchObject({
            lockCreated: false,
        })
        await Promise.all(
            attempts.map(async function (attempt) {
                expect(
                    await finishLoginAttemptService(
                        USERNAME,
                        attempt,
                        'failure',
                    ),
                ).toMatchObject({ applied: false, lockCreated: false })
            }),
        )
        expect(account().history?.stage).toBe(1)
    })

    it('charges an expired owner as failure even if a late success arrives', async function () {
        account().history = {
            failures: 2,
            stage: 0,
            expiresAt: model.now + TEST_HISTORY,
        }
        const attempt = await reserve()
        model.now += TEST_LEASE
        expect(
            await finishLoginAttemptService(USERNAME, attempt, 'success'),
        ).toEqual({
            applied: false,
            lockCreated: true,
            lockDurationSeconds: 30,
        })
        expect(account().history?.stage).toBe(1)
    })
})

describe('login attempt generation and history guards', function () {
    it('does not reap a foreign current orphan from an old-generation finish', async function () {
        const [winner, old] = await Promise.all([reserve(), reserve()])
        await finishLoginAttemptService(USERNAME, winner, 'success')
        const current = await reserve()
        model.now += TEST_LEASE
        expect(
            await finishLoginAttemptService(USERNAME, old, 'success'),
        ).toMatchObject({ applied: false })
        expect(account().history).toBeNull()
        expect(Array.from(account().inflight.values())).toEqual([current])
        await reserve()
        expect(account().history?.failures).toBe(1)
    })

    it('does not refresh a legacy failure history through admission while retaining metadata for 24h plus a lease', async function () {
        account().history = {
            failures: 2,
            stage: 2,
            expiresAt: model.now + TEST_HISTORY,
        }
        const historyExpiry = account().history?.expiresAt
        const first = await reserve()
        expect(account().generationExpiresAt).toBe(model.now + TEST_RETENTION)
        expect(account().inflightExpiresAt).toBe(model.now + TEST_RETENTION)
        model.now += 10_000
        await finishLoginAttemptService(USERNAME, first, 'neutral')
        await reserve()
        expect(account().history?.expiresAt).toBe(historyExpiry)
        expect(account().generationExpiresAt).toBe(model.now + TEST_RETENTION)
        expect(account().inflightExpiresAt).toBe(model.now + TEST_RETENTION)
    })

    it('preserves a newer recovery lock and history against an old normal success', async function () {
        const normal = await reserve()
        await recordFailedLogin(USERNAME)
        await recordFailedLogin(USERNAME)
        expect(await recordFailedLogin(USERNAME)).toEqual({
            lockCreated: true,
            lockDurationSeconds: 30,
        })
        const snapshot = structuredClone(account())
        model.now += 500
        expect(
            await finishLoginAttemptService(USERNAME, normal, 'success'),
        ).toEqual({
            applied: false,
            lockCreated: false,
            lockDurationSeconds: 30,
        })
        expect(account().lock).toEqual(snapshot.lock)
        expect(account().history).toEqual(snapshot.history)
        expect(account().generation).toBe(snapshot.generation)
        expect(account().inflight.size).toBe(0)
        expect(await recordFailedLogin(USERNAME)).toEqual({
            lockCreated: false,
            lockDurationSeconds: 30,
        })
        expect(account().lock).toEqual(snapshot.lock)
        expect(account().history).toEqual(snapshot.history)
    })

    it('does not extend an existing permanent legacy lock', async function () {
        account().lock = { expiresAt: null }
        expect(await reserveLoginAttemptService(USERNAME)).toEqual({
            allowed: false,
            reason: 'locked',
            retryAfterSeconds: 1,
            lockCreated: false,
        })
        expect(await recordFailedLogin(USERNAME)).toEqual({
            lockCreated: false,
            lockDurationSeconds: 1,
        })
        expect(account().lock?.expiresAt).toBeNull()
        expect(account().history).toBeNull()
        expect(account().generation).toBeNull()
    })

    it('applies a finish once and rejects forged, mismatched and cross-account owners', async function () {
        const attempt = await reserve()
        const snapshot = structuredClone(account())
        await Promise.all(
            [
                { ...attempt, attemptId: fixedId(1) },
                { ...attempt, generation: fixedId(2) },
                { ...attempt, expiresAtMs: attempt.expiresAtMs + 1 },
            ].map(async function (forged) {
                expect(
                    await finishLoginAttemptService(
                        USERNAME,
                        forged,
                        'success',
                    ),
                ).toMatchObject({ applied: false })
            }),
        )
        expect(
            await finishLoginAttemptService(
                'different-user',
                attempt,
                'success',
            ),
        ).toMatchObject({ applied: false })
        expect(account()).toEqual(snapshot)
        expect(
            await finishLoginAttemptService(USERNAME, attempt, 'failure'),
        ).toMatchObject({ applied: true })
        expect(
            await finishLoginAttemptService(USERNAME, attempt, 'failure'),
        ).toMatchObject({ applied: false })
        expect(account().history?.failures).toBe(1)
    })

    it.each([
        'missing generation',
        'persistent history',
        'persistent inflight',
        'oversized generation TTL',
    ])(
        'fails closed on inconsistent stored metadata: %s',
        async function (kind) {
            const attempt = await reserve()
            if (kind === 'missing generation') account().generation = null
            else if (kind === 'persistent history')
                account().history = { failures: 1, stage: 0, expiresAt: null }
            else if (kind === 'persistent inflight')
                account().inflightExpiresAt = null
            else account().generationExpiresAt = model.now + TEST_RETENTION + 1
            await expect(reserveLoginAttemptService(USERNAME)).rejects.toThrow(
                'Invalid login attempt',
            )
            await expect(
                finishLoginAttemptService(USERNAME, attempt, 'success'),
            ).rejects.toThrow('Invalid login attempt')
        },
    )
})

describe('login attempt Valkey boundary', function () {
    it('rounds every positive lock remainder up, including subsecond recovery locks', async function () {
        forcedReply = ['locked', '', '', 0, 1, 0]
        expect(await reserveLoginAttemptService(USERNAME)).toEqual({
            allowed: false,
            reason: 'locked',
            retryAfterSeconds: 1,
            lockCreated: false,
        })
        forcedReply = ['recorded', '', '', 0, 499, 0]
        expect(await recordFailedLogin(USERNAME)).toEqual({
            lockCreated: false,
            lockDurationSeconds: 1,
        })
    })

    it.each([
        { name: 'null', value: null },
        { name: 'empty tuple', value: [] },
        { name: 'short tuple', value: ['locked', '', '', 0, 1000] },
        { name: 'unknown status', value: ['unexpected', '', '', 0, 1000, 0] },
        { name: 'string TTL', value: ['locked', '', '', 0, '1000', 0] },
        { name: 'negative TTL', value: ['locked', '', '', 0, -1, 0] },
        {
            name: 'nonboolean creation flag',
            value: ['locked', '', '', 0, 1000, 2],
        },
    ])('rejects malformed Valkey tuples: $name', async function ({ value }) {
        const attempt = await reserve()
        forcedReply = value
        await expect(reserveLoginAttemptService(USERNAME)).rejects.toThrow()
        await expect(
            finishLoginAttemptService(USERNAME, attempt, 'success'),
        ).rejects.toThrow()
        await expect(recordFailedLogin(USERNAME)).rejects.toThrow()
        expect(account().history).toBeNull()
        expect(account().inflight.size).toBe(1)
    })

    it.each(['connection', 'eval'])(
        'propagates %s failures without claiming completion',
        async function (boundary) {
            const attempt = await reserve()
            if (boundary === 'connection')
                connectionError = new Error('synthetic storage failure')
            else evalError = new Error('synthetic storage failure')
            await expect(reserveLoginAttemptService(USERNAME)).rejects.toThrow(
                'synthetic storage failure',
            )
            await expect(
                finishLoginAttemptService(USERNAME, attempt, 'failure'),
            ).rejects.toThrow('synthetic storage failure')
            await expect(recordFailedLogin(USERNAME)).rejects.toThrow(
                'synthetic storage failure',
            )
            expect(account().history).toBeNull()
        },
    )

    it('passes four exact account keys and the fixed policy to one Lua boundary for each operation', async function () {
        const attempt = await reserve()
        const reserveCall = valkey.eval.mock.calls[0]
        const prefix = accountPrefix(USERNAME)
        expect(reserveCall[1]).toBe(4)
        expect(reserveCall.slice(2, 6)).toEqual(
            ['state', 'lock', 'generation', 'inflight'].map(function (suffix) {
                return prefix + ':' + suffix
            }),
        )
        const reserveArgs = reserveCall.slice(6)
        expect(reserveArgs.slice(0, 4)).toEqual([
            'reserve',
            attempt.attemptId,
            '',
            '',
        ])
        expect(canonicalId(String(reserveArgs[4]))).toBe(true)
        expect(reserveArgs.slice(5)).toEqual([
            '30000',
            '3',
            '30',
            '180',
            '900',
            '86400',
            '86430000',
            '0',
        ])
        await finishLoginAttemptService(USERNAME, attempt, 'neutral')
        const finishArgs = valkey.eval.mock.calls[1].slice(6)
        expect(finishArgs.slice(0, 4)).toEqual([
            'finish',
            attempt.attemptId,
            attempt.generation,
            'neutral',
        ])
        expect(finishArgs[12]).toBe(String(attempt.expiresAtMs))
        await recordFailedLogin(USERNAME)
        expect(valkey.eval.mock.calls[2].slice(6, 10)).toEqual([
            'recovery-failure',
            '',
            '',
            '',
        ])
        expect(
            new Set(
                valkey.eval.mock.calls.map(function (call) {
                    return call[0]
                }),
            ).size,
        ).toBe(1)
        expect(reserveCall[0]).toBe(LOGIN_ATTEMPT_SCRIPT)
    })
})

describe('login attempt completion races', function () {
    it('does not let a live success erase a lock created by other current orphans', async function () {
        await Promise.all([reserve(), reserve()])
        model.now += 1000
        const live = await reserve()
        await recordFailedLogin(USERNAME)
        model.now += TEST_LEASE - 1000
        expect(
            await finishLoginAttemptService(USERNAME, live, 'success'),
        ).toEqual({
            applied: false,
            lockCreated: true,
            lockDurationSeconds: 30,
        })
        expect(account().history?.stage).toBe(1)
        expect(account().inflight.size).toBe(0)
        expect(account().lock?.expiresAt).toBe(model.now + 30_000)
    })

    it('rejects well-shaped tuples belonging to a different operation or contradicting success', async function () {
        const attempt = await reserve()
        forcedReply = ['applied', '', '', 0, 0, 0]
        await expect(reserveLoginAttemptService(USERNAME)).rejects.toThrow(
            'Invalid login attempt response',
        )
        forcedReply = ['recorded', '', '', 0, 0, 0]
        await expect(
            finishLoginAttemptService(USERNAME, attempt, 'success'),
        ).rejects.toThrow('Invalid login attempt response')
        forcedReply = ['stale', '', '', 0, 0, 0]
        await expect(recordFailedLogin(USERNAME)).rejects.toThrow(
            'Invalid login attempt response',
        )
        forcedReply = ['applied', '', '', 0, 30_000, 1]
        await expect(
            finishLoginAttemptService(USERNAME, attempt, 'success'),
        ).rejects.toThrow('Invalid login attempt response')
    })

    it('keeps source barriers for shared account pressure, ownership and history-preserving admission', async function () {
        await reserve()
        const script = valkey.eval.mock.calls[0][0]
        expect(script).toContain("server.call('TIME')")
        expect(script).toContain(
            'if #KEYS ~= 4 or #ARGV ~= 13 then return invalid() end',
        )
        expect(script).toContain(
            "if types[4] == 'zset' and not generation then return invalid() end",
        )
        expect(script).toContain('failures + liveCount >= maximumFailures')
        expect(script).toContain('entry.expiry == expectedExpiry')
        expect(script).toContain("server.call('ZADD', KEYS[4], 'NX'")
        const admissionStart = script.indexOf(
            "if locked then return reply('locked', lockMs) end",
        )
        expect(admissionStart).toBeGreaterThan(0)
        const admission = script.slice(admissionStart)
        expect(admission).toContain(
            "server.call('PEXPIRE', KEYS[4], retentionMs)",
        )
        expect(admission).not.toContain('KEYS[1]')
        expect(admission).not.toContain("server.call('DEL'")
    })
})

describe('exact Valkey retries and token boundaries', function () {
    it('replays the original complete reserve EVAL without extending its lease or retention', async function () {
        const first = await reserve()
        const originalCall = valkey.eval.mock.calls[0]
        expect(originalCall[10]).toBe(first.generation)
        const script = originalCall[0]
        const replayReturn = script.indexOf(
            "return { 'reserved', entry.generation, entry.id, entry.expiry, 0, 0 }",
        )
        const admissionGuard = script.indexOf(
            'if not canRecordFailures(0) then return invalid() end',
        )
        expect(replayReturn).toBeGreaterThan(0)
        expect(admissionGuard).toBeGreaterThan(replayReturn)
        expect(script).not.toContain('or nextGeneration == generation')
        expect(script).not.toContain('or nextGeneration == memberGeneration')
        model.now += 1000
        const snapshot = structuredClone(account())
        expect(await valkey.eval(...originalCall)).toEqual([
            'reserved',
            first.generation,
            first.attemptId,
            first.expiresAtMs,
            0,
            0,
        ])
        expect(valkey.eval.mock.calls[1]).toEqual(originalCall)
        expect(account()).toEqual(snapshot)
        await Promise.all([reserve(), reserve()])
        expect(await reserveLoginAttemptService(USERNAME)).toMatchObject({
            allowed: false,
            reason: 'busy',
        })
        expect(account().inflight.size).toBe(3)
    })

    it('charges an expired exact reserve retry once and returns busy without renewing it', async function () {
        const first = await reserve()
        const originalCall = valkey.eval.mock.calls[0]
        model.now = first.expiresAtMs
        expect(await valkey.eval(...originalCall)).toEqual([
            'busy',
            '',
            '',
            0,
            1,
            0,
        ])
        expect(account().history?.failures).toBe(1)
        expect(account().inflight.size).toBe(0)
        expect(
            await finishLoginAttemptService(USERNAME, first, 'failure'),
        ).toMatchObject({ applied: false })
        expect(account().history?.failures).toBe(1)
    })

    it('treats an unchanged successful finish EVAL replay as stale without clearing newer failures', async function () {
        const attempt = await reserve()
        await finishLoginAttemptService(USERNAME, attempt, 'success')
        const originalCall = valkey.eval.mock.calls[1]
        expect(account().generation).toBe(originalCall[10])
        await recordFailedLogin(USERNAME)
        const snapshot = structuredClone(account())
        expect(await valkey.eval(...originalCall)).toEqual([
            'stale',
            '',
            '',
            0,
            0,
            0,
        ])
        expect(account()).toEqual(snapshot)
        expect(account().history?.failures).toBe(1)
    })

    it.each(['generation', 'attemptId'])(
        'rejects a final newline in %s before accessing Valkey',
        async function (field) {
            const attempt = await reserve()
            const malformed =
                field === 'generation'
                    ? { ...attempt, generation: attempt.generation + '\n' }
                    : { ...attempt, attemptId: attempt.attemptId + '\n' }
            getValkeyConnection.mockClear()
            valkey.eval.mockClear()
            await expect(
                finishLoginAttemptService(USERNAME, malformed, 'success'),
            ).rejects.toThrow('Invalid login attempt completion')
            expect(getValkeyConnection).not.toHaveBeenCalled()
            expect(valkey.eval).not.toHaveBeenCalled()
        },
    )

    it('rejects a reserved generation with a final newline even when its returned owner ID matches', async function () {
        valkey.eval.mockImplementationOnce(async function (
            _script,
            _keyCount,
            ...values
        ) {
            return [
                'reserved',
                fixedId(1) + '\n',
                values[5],
                model.now + TEST_LEASE,
                0,
                0,
            ]
        })
        await expect(reserveLoginAttemptService(USERNAME)).rejects.toThrow(
            'Invalid login attempt response',
        )
    })
})
