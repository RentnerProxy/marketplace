import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { SQL } from 'drizzle-orm'
import { boolean, PgDialect, pgTable, text } from 'drizzle-orm/pg-core'
import * as OTPAuth from 'otpauth'
import {
    decryptAuthSecret,
    encryptAuthSecret,
} from '@/lib/Auth/secretEncryption.ts'
import type { TotpFactor } from '@/server/Auth/Types/totp.types.ts'
import {
    consumeTotpCodeService,
    createActiveTotpSecret,
} from '@/server/Auth/totp-verification.service.ts'
import type {
    TotpPredicateEquality,
    TotpReplayTestState,
} from './totp-verification.test.types.ts'

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const NOW = 1_800_000_000_000
const PERIOD_MS = 30_000
const CURRENT_STEP = NOW / PERIOD_MS
const IDENTITY = {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
}

const twoFactorTable = pgTable('two_factor_auth', {
    id: text('id'),
    userId: text('userId'),
    secret: text('secret'),
    verified: boolean('verified'),
})
const settingsTable = pgTable('system_settings', {
    companyName: text('companyName'),
})

function readEqualities(condition: SQL): Array<TotpPredicateEquality> {
    const query = new PgDialect().sqlToQuery(condition)
    const clauses = query.sql.replace(/^\((.*)\)$/, '$1').split(' and ')

    return clauses.map(function (clause) {
        const match =
            /^"two_factor_auth"\."(id|userId|secret|verified)" = \$(\d+)$/.exec(
                clause,
            )
        if (!match) {
            throw new Error(
                'Unsupported synthetic database predicate: ' + clause,
            )
        }
        const field = match[1]
        const parameterIndex = Number(match[2]) - 1
        if (
            (field !== 'id' &&
                field !== 'userId' &&
                field !== 'secret' &&
                field !== 'verified') ||
            parameterIndex < 0 ||
            parameterIndex >= query.params.length
        ) {
            throw new Error('Invalid synthetic database equality')
        }
        return { field, value: query.params[parameterIndex] }
    })
}

const database = (function () {
    const state: TotpReplayTestState = {
        rows: [],
        conditions: [],
        attemptedUpdates: 0,
        successfulWrites: 0,
        beforeCompare: null,
        databaseFailure: null,
        failAfterWrite: false,
    }

    return {
        state,
        db: {
            update(table: unknown) {
                if (table !== twoFactorTable) {
                    throw new Error('Unexpected synthetic database table')
                }
                return {
                    set(values: { secret: string }) {
                        if (Object.keys(values).join(',') !== 'secret') {
                            throw new Error(
                                'Unexpected synthetic database update',
                            )
                        }
                        return {
                            where(condition: SQL) {
                                const equalities = readEqualities(condition)
                                state.conditions.push(equalities)
                                return {
                                    async returning() {
                                        state.attemptedUpdates += 1
                                        const beforeCompare =
                                            state.beforeCompare
                                        state.beforeCompare = null
                                        beforeCompare?.()
                                        if (
                                            state.databaseFailure &&
                                            !state.failAfterWrite
                                        ) {
                                            throw state.databaseFailure
                                        }
                                        const consumed: Array<{ id: string }> =
                                            []

                                        state.rows = state.rows.map(
                                            function (row) {
                                                if (
                                                    !equalities.every(
                                                        function (equality) {
                                                            return (
                                                                row[
                                                                    equality
                                                                        .field
                                                                ] ===
                                                                equality.value
                                                            )
                                                        },
                                                    )
                                                ) {
                                                    return row
                                                }
                                                consumed.push({ id: row.id })
                                                state.successfulWrites += 1
                                                return {
                                                    ...row,
                                                    secret: values.secret,
                                                }
                                            },
                                        )
                                        if (state.databaseFailure) {
                                            throw state.databaseFailure
                                        }
                                        return consumed
                                    },
                                }
                            },
                        }
                    },
                }
            },
        },
    }
})()

vi.mock('@/db', function () {
    return { db: database.db }
})
vi.mock('@/db/schema.ts', function () {
    return { twoFactorAuth: twoFactorTable, systemSettings: settingsTable }
})
vi.mock('@/server/Runtime/environment.service.ts', function () {
    return {
        getRequiredServerEnvironment(key: string) {
            if (key !== 'AUTH_ENCRYPTION_KEY') {
                throw new Error('Unexpected synthetic environment key')
            }
            return Buffer.alloc(32, 7).toString('base64')
        },
    }
})

function tokenForStep(step: number) {
    return new OTPAuth.TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: SECRET,
    }).generate({ timestamp: step * PERIOD_MS })
}

function activePayload(lastConsumedStep = CURRENT_STEP - 1) {
    return {
        purpose: 'totp-state-v1',
        factorId: IDENTITY.id,
        userId: IDENTITY.userId,
        secret: SECRET,
        lastConsumedStep,
    }
}

function installFactor(secret: string, overrides: Partial<TotpFactor> = {}) {
    const factor: TotpFactor = {
        ...IDENTITY,
        secret,
        verified: true,
        ...overrides,
    }
    database.state.rows = [{ ...factor }]
    return { ...factor }
}

async function installActiveFactor(lastConsumedStep = CURRENT_STEP - 1) {
    return installFactor(
        await createActiveTotpSecret(SECRET, lastConsumedStep, IDENTITY),
    )
}

function currentFactor() {
    const factor = database.state.rows[0]
    if (!factor) {
        throw new Error('Missing synthetic factor')
    }
    return { ...factor }
}

async function storedPayload(): Promise<unknown> {
    return JSON.parse(await decryptAuthSecret(currentFactor().secret))
}

function expectNoUpdate() {
    expect(database.state.attemptedUpdates).toBe(0)
    expect(database.state.successfulWrites).toBe(0)
}

describe('consumeTotpCodeService replay protection', function () {
    let nowMock: Mock<typeof Date.now>

    beforeEach(function () {
        database.state.rows = []
        database.state.conditions = []
        database.state.attemptedUpdates = 0
        database.state.successfulWrites = 0
        database.state.beforeCompare = null
        database.state.databaseFailure = null
        database.state.failAfterWrite = false
        nowMock = vi.spyOn(Date, 'now').mockReturnValue(NOW)
    })

    afterEach(function () {
        vi.restoreAllMocks()
    })

    it('authenticates the factor identity and consumed step inside AES-GCM ciphertext', async function () {
        const encrypted = await createActiveTotpSecret(
            SECRET,
            CURRENT_STEP,
            IDENTITY,
        )

        expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
        expect(encrypted).not.toContain(SECRET)
        expect(encrypted).not.toContain('totp-state-v1')
        expect(JSON.parse(await decryptAuthSecret(encrypted))).toEqual(
            activePayload(CURRENT_STEP),
        )
    })

    it.each(['encrypted legacy', 'active state'])(
        'allows exactly one concurrent consumption for %s',
        async function (format) {
            const secret =
                format === 'encrypted legacy'
                    ? await encryptAuthSecret(SECRET)
                    : await createActiveTotpSecret(
                          SECRET,
                          CURRENT_STEP - 1,
                          IDENTITY,
                      )
            const snapshot = installFactor(secret)
            const token = tokenForStep(CURRENT_STEP)

            const results = await Promise.all(
                Array.from({ length: 8 }, function () {
                    return consumeTotpCodeService({ ...snapshot }, token)
                }),
            )

            expect(results.filter(Boolean)).toHaveLength(1)
            expect(
                results.filter(function (result) {
                    return !result
                }),
            ).toHaveLength(7)
            expect(database.state.attemptedUpdates).toBe(8)
            expect(database.state.successfulWrites).toBe(1)
            expect(await storedPayload()).toEqual(activePayload(CURRENT_STEP))
            expect(await consumeTotpCodeService(currentFactor(), token)).toBe(
                false,
            )
            expect(database.state.successfulWrites).toBe(1)
        },
    )

    it('compares id, userId, verified and the original ciphertext in its atomic update', async function () {
        const factor = await installActiveFactor()

        expect(
            await consumeTotpCodeService(factor, tokenForStep(CURRENT_STEP)),
        ).toBe(true)
        expect(database.state.conditions).toEqual([
            [
                { field: 'id', value: factor.id },
                { field: 'userId', value: factor.userId },
                { field: 'verified', value: true },
                { field: 'secret', value: factor.secret },
            ],
        ])
        expect(currentFactor().secret).not.toBe(factor.secret)
        expect(await storedPayload()).toEqual(activePayload(CURRENT_STEP))
    })

    it('rejects the setup confirmation step and accepts the following step', async function () {
        const factor = await installActiveFactor(CURRENT_STEP)

        expect(
            await consumeTotpCodeService(factor, tokenForStep(CURRENT_STEP)),
        ).toBe(false)
        expectNoUpdate()
        nowMock.mockReturnValue(NOW + PERIOD_MS)
        expect(
            await consumeTotpCodeService(
                currentFactor(),
                tokenForStep(CURRENT_STEP + 1),
            ),
        ).toBe(true)
        expect(await storedPayload()).toEqual(activePayload(CURRENT_STEP + 1))
    })

    it.each([
        { offset: -2, accepted: false },
        { offset: -1, accepted: true },
        { offset: 0, accepted: true },
        { offset: 1, accepted: true },
        { offset: 2, accepted: false },
    ])(
        'applies the one-step TOTP window at offset $offset',
        async function ({ offset, accepted }) {
            const factor = await installActiveFactor(CURRENT_STEP - 2)

            expect(
                await consumeTotpCodeService(
                    factor,
                    tokenForStep(CURRENT_STEP + offset),
                ),
            ).toBe(accepted)
            if (accepted) {
                expect(await storedPayload()).toEqual(
                    activePayload(CURRENT_STEP + offset),
                )
            } else {
                expectNoUpdate()
            }
        },
    )

    it('requires strictly increasing steps even for valid older and future-window codes', async function () {
        const factor = await installActiveFactor(CURRENT_STEP - 2)
        expect(
            await consumeTotpCodeService(factor, tokenForStep(CURRENT_STEP)),
        ).toBe(true)
        expect(
            await consumeTotpCodeService(
                currentFactor(),
                tokenForStep(CURRENT_STEP - 1),
            ),
        ).toBe(false)
        expect(
            await consumeTotpCodeService(
                currentFactor(),
                tokenForStep(CURRENT_STEP),
            ),
        ).toBe(false)
        expect(
            await consumeTotpCodeService(
                currentFactor(),
                tokenForStep(CURRENT_STEP + 1),
            ),
        ).toBe(true)
        expect(await storedPayload()).toEqual(activePayload(CURRENT_STEP + 1))

        nowMock.mockReturnValue(NOW + PERIOD_MS)
        expect(
            await consumeTotpCodeService(
                currentFactor(),
                tokenForStep(CURRENT_STEP + 1),
            ),
        ).toBe(false)
        expect(
            await consumeTotpCodeService(
                currentFactor(),
                tokenForStep(CURRENT_STEP + 2),
            ),
        ).toBe(true)
        expect(database.state.successfulWrites).toBe(3)
        expect(await storedPayload()).toEqual(activePayload(CURRENT_STEP + 2))
    })

    it('uses one timestamp snapshot when verification crosses a period boundary', async function () {
        const factor = await installActiveFactor()
        const token = tokenForStep(CURRENT_STEP)
        nowMock
            .mockClear()
            .mockReturnValueOnce(NOW + PERIOD_MS - 1)
            .mockReturnValue(NOW + PERIOD_MS)

        expect(await consumeTotpCodeService(factor, token)).toBe(true)
        expect(await storedPayload()).toEqual(activePayload(CURRENT_STEP))
        expect(Date.now).toHaveBeenCalledTimes(1)
    })

    it.each(['id', 'userId'])(
        'rejects ciphertext copied to a different factor %s',
        async function (field) {
            const encrypted = await createActiveTotpSecret(
                SECRET,
                CURRENT_STEP - 1,
                IDENTITY,
            )
            const factor = installFactor(encrypted, {
                [field]: 'different-identity',
            })

            expect(
                await consumeTotpCodeService(
                    factor,
                    tokenForStep(CURRENT_STEP),
                ),
            ).toBe(false)
            expectNoUpdate()
        },
    )

    it('rejects an unverified factor before attempting an update', async function () {
        const encrypted = await createActiveTotpSecret(
            SECRET,
            CURRENT_STEP - 1,
            IDENTITY,
        )
        const factor = installFactor(encrypted, { verified: false })

        expect(
            await consumeTotpCodeService(factor, tokenForStep(CURRENT_STEP)),
        ).toBe(false)
        expectNoUpdate()
    })

    it.each(['id', 'userId', 'verified', 'secret', 'deleted'])(
        'rejects a stale factor when %s changes before comparison',
        async function (change) {
            const snapshot = await installActiveFactor()
            const replacementSecret = await createActiveTotpSecret(
                SECRET,
                CURRENT_STEP + 1,
                IDENTITY,
            )
            const replacement =
                change === 'id'
                    ? { ...snapshot, id: 'replacement-factor' }
                    : change === 'userId'
                      ? { ...snapshot, userId: 'replacement-user' }
                      : change === 'verified'
                        ? { ...snapshot, verified: false }
                        : { ...snapshot, secret: replacementSecret }
            const expectedRows = change === 'deleted' ? [] : [replacement]
            database.state.beforeCompare = function () {
                database.state.rows = expectedRows.map(function (row) {
                    return { ...row }
                })
            }

            expect(
                await consumeTotpCodeService(
                    snapshot,
                    tokenForStep(CURRENT_STEP),
                ),
            ).toBe(false)
            expect(database.state.attemptedUpdates).toBe(1)
            expect(database.state.successfulWrites).toBe(0)
            expect(database.state.rows).toEqual(expectedRows)
        },
    )

    it.each(['legacy-seed', 'replay-state'])(
        'rejects plaintext $format with a valid code without any database update',
        async function (format) {
            const factor = installFactor(
                format === 'legacy-seed'
                    ? SECRET
                    : JSON.stringify(activePayload()),
            )
            const before = structuredClone(database.state.rows)
            const results = await Promise.all(
                Array.from({ length: 32 }, function () {
                    return consumeTotpCodeService(
                        { ...factor },
                        tokenForStep(CURRENT_STEP),
                    )
                }),
            )

            expect(results).toEqual(Array<boolean>(32).fill(false))
            expectNoUpdate()
            expect(database.state.rows).toEqual(before)
        },
    )

    it.each([
        { name: 'malformed JSON', plaintext: '{' },
        { name: 'null', plaintext: 'null' },
        { name: 'array', plaintext: '[]' },
        {
            name: 'legacy JSON wrapper',
            plaintext: JSON.stringify({ secret: SECRET }),
        },
        {
            name: 'unknown purpose',
            plaintext: JSON.stringify({
                ...activePayload(),
                purpose: 'totp-state-v2',
            }),
        },
        {
            name: 'missing purpose',
            plaintext: JSON.stringify({
                ...activePayload(),
                purpose: undefined,
            }),
        },
        {
            name: 'extra property',
            plaintext: JSON.stringify({ ...activePayload(), trusted: true }),
        },
        {
            name: 'negative step',
            plaintext: JSON.stringify({
                ...activePayload(),
                lastConsumedStep: -1,
            }),
        },
        {
            name: 'fractional step',
            plaintext: JSON.stringify({
                ...activePayload(),
                lastConsumedStep: 1.5,
            }),
        },
        {
            name: 'string step',
            plaintext: JSON.stringify({
                ...activePayload(),
                lastConsumedStep: '60000000',
            }),
        },
        {
            name: 'short seed',
            plaintext: JSON.stringify({
                ...activePayload(),
                secret: SECRET.slice(0, 16),
            }),
        },
        {
            name: 'non-Base32 seed',
            plaintext: JSON.stringify({
                ...activePayload(),
                secret: '8'.repeat(32),
            }),
        },
    ])(
        'rejects authenticated but invalid state: $name',
        async function ({ plaintext }) {
            const factor = installFactor(await encryptAuthSecret(plaintext))

            expect(
                await consumeTotpCodeService(
                    factor,
                    tokenForStep(CURRENT_STEP),
                ),
            ).toBe(false)
            expectNoUpdate()
        },
    )

    it.each(
        ['plaintext', 'encrypted'].flatMap(function (format) {
            return [
                { name: 'lowercase', secret: SECRET.toLowerCase() },
                { name: 'short', secret: SECRET.slice(0, 16) },
                { name: 'non-Base32', secret: '8'.repeat(32) },
            ].map(function (fixture) {
                return { format, name: fixture.name, secret: fixture.secret }
            })
        }),
    )(
        'rejects $format legacy seeds that are $name',
        async function ({ format, secret }) {
            const factor = installFactor(
                format === 'encrypted'
                    ? await encryptAuthSecret(secret)
                    : secret,
            )

            expect(
                await consumeTotpCodeService(
                    factor,
                    tokenForStep(CURRENT_STEP),
                ),
            ).toBe(false)
            expectNoUpdate()
        },
    )

    it.each(
        ['legacy', 'active'].flatMap(function (format) {
            return [
                'tampered',
                'extra segment',
                'unknown version',
                'missing ciphertext',
                'missing IV',
            ].map(function (problem) {
                return { format, problem }
            })
        }),
    )(
        'rejects $format encryption envelopes with $problem',
        async function ({ format, problem }) {
            const encrypted =
                format === 'legacy'
                    ? await encryptAuthSecret(SECRET)
                    : await createActiveTotpSecret(
                          SECRET,
                          CURRENT_STEP - 1,
                          IDENTITY,
                      )
            const parts = encrypted.split('.')
            const encryptedBytes = Buffer.from(parts[2], 'base64url')
            encryptedBytes[0] ^= 1
            const tampered = [
                parts[0],
                parts[1],
                encryptedBytes.toString('base64url'),
            ].join('.')
            const malformed =
                problem === 'tampered'
                    ? tampered
                    : problem === 'extra segment'
                      ? encrypted + '.ignored'
                      : problem === 'unknown version'
                        ? encrypted.replace(/^v1/, 'v2')
                        : problem === 'missing ciphertext'
                          ? 'v1.' + parts[1]
                          : 'v1..' + parts[2]
            const factor = installFactor(malformed)

            expect(
                await consumeTotpCodeService(
                    factor,
                    tokenForStep(CURRENT_STEP),
                ),
            ).toBe(false)
            expectNoUpdate()
        },
    )

    it.each(['', '12345', '1234567', 'abcdef', ' 123456', '123456 '])(
        'rejects malformed token %j without writing',
        async function (token) {
            const factor = await installActiveFactor()
            expect(await consumeTotpCodeService(factor, token)).toBe(false)
            expectNoUpdate()
        },
    )

    it.each(['encrypted legacy', 'active state'])(
        'keeps %s unchanged after a wrong six-digit code',
        async function (format) {
            const validCodes = new Set(
                [-1, 0, 1].map(function (offset) {
                    return tokenForStep(CURRENT_STEP + offset)
                }),
            )
            const wrongCode = ['000000', '000001', '000002', '000003'].find(
                function (token) {
                    return !validCodes.has(token)
                },
            )
            if (!wrongCode) {
                throw new Error('Missing invalid synthetic TOTP code')
            }
            const secret =
                format === 'encrypted legacy'
                    ? await encryptAuthSecret(SECRET)
                    : await createActiveTotpSecret(
                          SECRET,
                          CURRENT_STEP - 1,
                          IDENTITY,
                      )
            const factor = installFactor(secret)

            expect(await consumeTotpCodeService(factor, wrongCode)).toBe(false)
            expectNoUpdate()
            expect(currentFactor()).toEqual(factor)
        },
    )

    it.each([false, true])(
        'never reports success when the database throws (write happened: %s)',
        async function (failAfterWrite) {
            const factor = await installActiveFactor()
            database.state.databaseFailure = new Error(
                'synthetic database failure',
            )
            database.state.failAfterWrite = failAfterWrite

            await expect(
                consumeTotpCodeService(factor, tokenForStep(CURRENT_STEP)),
            ).rejects.toThrow('synthetic database failure')
            expect(database.state.attemptedUpdates).toBe(1)
            expect(database.state.successfulWrites).toBe(failAfterWrite ? 1 : 0)
            if (!failAfterWrite) {
                expect(currentFactor()).toEqual(factor)
            } else {
                database.state.databaseFailure = null
                expect(
                    await consumeTotpCodeService(
                        currentFactor(),
                        tokenForStep(CURRENT_STEP),
                    ),
                ).toBe(false)
            }
        },
    )
})
