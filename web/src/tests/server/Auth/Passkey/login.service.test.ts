import type { Mock } from 'bun:test'
import { recordRejectedAuthenticationService } from '@/server/Auth/rejected-authentication.service.ts'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { generateAuthenticationOptions } from '@simplewebauthn/server'
import type { createAuthenticatedSessionForUser } from '@/server/Auth/Login/session.service.ts'
import {
    beginPasskeyLoginService,
    finishPasskeyLoginService,
} from '@/server/Auth/Passkey/login.service.ts'
import { AUTHENTICATION_CHALLENGE_TYPE } from '@/server/Auth/Passkey/challenge.service.ts'
import type {
    PasskeyLoginTestColumn,
    PasskeyLoginTestPredicate,
    PasskeyLoginTestRow,
    PasskeyLoginTestScope,
    PasskeyLoginTestState,
} from './login.service.test.types.ts'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const CHALLENGE_ID = '01990abc-0000-7000-8000-000000000001'
const USER_HANDLE = 'AQI'
const CHALLENGE_TYPE = 'authentication-discoverable-v2'
const FAILURE = {
    success: false as const,
    error: 'Passkey-Anmeldung konnte nicht bestätigt werden.',
}
const EXPIRED = {
    success: false as const,
    error: 'Passkey-Anmeldung ist abgelaufen. Bitte starte erneut.',
}
const SUCCESS = {
    success: true,
    redirectTo: '/user',
    user: {
        id: USER_ID,
        username: 'known-user',
        email: 'user@example.test',
        isActive: true,
        permissions: [],
    },
} satisfies Awaited<ReturnType<typeof createAuthenticatedSessionForUser>>
const PASSKEY_CONFIG = {
    origin: 'https://login.example.test',
    rpID: 'example.test',
    rpName: 'Synthetic Test App',
}

function column(
    scope: keyof PasskeyLoginTestScope,
    field: string,
): PasskeyLoginTestColumn {
    return { scope, field }
}

const schema = {
    users: {
        id: column('user', 'id'),
        username: column('user', 'username'),
        isDeleted: column('user', 'isDeleted'),
    },
    passkeyCredentials: {
        id: column('passkey', 'id'),
        userId: column('passkey', 'userId'),
        credentialId: column('passkey', 'credentialId'),
        counter: column('passkey', 'counter'),
    },
    passkeyChallenges: {
        id: column('challenge', 'id'),
        type: column('challenge', 'type'),
        identifier: column('challenge', 'identifier'),
        expiresAt: column('challenge', 'expiresAt'),
    },
}

function resolveValue(value: unknown, scope: PasskeyLoginTestScope): unknown {
    if (
        typeof value === 'object' &&
        value !== null &&
        'scope' in value &&
        'field' in value &&
        typeof value.field === 'string' &&
        (value.scope === 'challenge' ||
            value.scope === 'passkey' ||
            value.scope === 'user')
    ) {
        return scope[value.scope]?.[value.field]
    }
    return value
}

function matches(
    predicate: PasskeyLoginTestPredicate,
    scope: PasskeyLoginTestScope,
): boolean {
    if (predicate.kind === 'and') {
        return predicate.conditions.every(function (condition) {
            return matches(condition, scope)
        })
    }
    const actual = resolveValue(predicate.column, scope)
    if (predicate.kind === 'eq') {
        return actual === resolveValue(predicate.value, scope)
    }
    if (!(actual instanceof Date)) {
        throw new Error('Synthetic database expected a date comparison')
    }
    return predicate.kind === 'gt'
        ? actual > predicate.value
        : actual < predicate.value
}

const database = (function () {
    const state: PasskeyLoginTestState = {
        challenges: [],
        passkeys: [],
        users: [],
        insertedChallenges: [],
        lookupConditions: [],
    }
    return {
        state,
        db: {
            select: vi.fn(function () {
                return {
                    from(table: unknown) {
                        if (table !== schema.passkeyCredentials) {
                            throw new Error(
                                'Unexpected user lookup in passkey login',
                            )
                        }
                        return {
                            innerJoin(
                                joinTable: unknown,
                                join: PasskeyLoginTestPredicate,
                            ) {
                                if (joinTable !== schema.users) {
                                    throw new Error('Unexpected synthetic join')
                                }
                                return {
                                    where(
                                        predicate: PasskeyLoginTestPredicate,
                                    ) {
                                        state.lookupConditions.push(predicate)
                                        return {
                                            async limit(count: number) {
                                                const rows =
                                                    state.passkeys.flatMap(
                                                        function (passkey) {
                                                            return state.users.flatMap(
                                                                function (
                                                                    user,
                                                                ) {
                                                                    const scope =
                                                                        {
                                                                            passkey,
                                                                            user,
                                                                        }
                                                                    return matches(
                                                                        join,
                                                                        scope,
                                                                    ) &&
                                                                        matches(
                                                                            predicate,
                                                                            scope,
                                                                        )
                                                                        ? [
                                                                              {
                                                                                  passkey:
                                                                                      {
                                                                                          ...passkey,
                                                                                      },
                                                                                  user: {
                                                                                      ...user,
                                                                                  },
                                                                              },
                                                                          ]
                                                                        : []
                                                                },
                                                            )
                                                        },
                                                    )
                                                return rows.slice(0, count)
                                            },
                                        }
                                    },
                                }
                            },
                        }
                    },
                }
            }),
            insert: vi.fn(function (table: unknown) {
                if (table !== schema.passkeyChallenges) {
                    throw new Error('Unexpected synthetic insert')
                }
                return {
                    values(values: PasskeyLoginTestRow) {
                        state.insertedChallenges.push(values)
                        const row = {
                            ...values,
                            id: 'challenge-' + state.insertedChallenges.length,
                            userId: values.userId ?? null,
                            identifier: values.identifier ?? null,
                        }
                        state.challenges.push(row)
                        return {
                            returning: async function () {
                                return [row]
                            },
                        }
                    },
                }
            }),
            delete: vi.fn(function (table: unknown) {
                if (table !== schema.passkeyChallenges) {
                    throw new Error('Unexpected synthetic delete')
                }
                return {
                    where(predicate: PasskeyLoginTestPredicate) {
                        const removed = state.challenges.filter(
                            function (challenge) {
                                return matches(predicate, { challenge })
                            },
                        )
                        state.challenges = state.challenges.filter(
                            function (challenge) {
                                return !matches(predicate, { challenge })
                            },
                        )
                        return {
                            returning: async function () {
                                return removed
                            },
                        }
                    },
                }
            }),
            update: vi.fn(function () {
                throw new Error(
                    'Credential updates belong to session finalization',
                )
            }),
        },
    }
})()

const services = {
    generateOptions: vi.fn(async function (
        options: Parameters<typeof generateAuthenticationOptions>[0],
    ) {
        return {
            challenge: 'synthetic-webauthn-challenge',
            rpId: options.rpID,
            timeout: options.timeout,
            userVerification: options.userVerification,
            ...('allowCredentials' in options
                ? { allowCredentials: options.allowCredentials }
                : {}),
        }
    }),
    verify: vi.fn(async function () {
        return { verified: true, authenticationInfo: { newCounter: 8 } }
    }),
    createSession: vi.fn(async function (): Promise<
        Awaited<ReturnType<typeof createAuthenticatedSessionForUser>>
    > {
        return SUCCESS
    }),
}

vi.mock('drizzle-orm', function () {
    return {
        and: function (
            ...conditions: Array<PasskeyLoginTestPredicate>
        ): PasskeyLoginTestPredicate {
            return { kind: 'and', conditions }
        },
        eq: function (
            field: PasskeyLoginTestColumn,
            value: unknown,
        ): PasskeyLoginTestPredicate {
            return { kind: 'eq', column: field, value }
        },
        gt: function (
            field: PasskeyLoginTestColumn,
            value: Date,
        ): PasskeyLoginTestPredicate {
            return { kind: 'gt', column: field, value }
        },
        lt: function (
            field: PasskeyLoginTestColumn,
            value: Date,
        ): PasskeyLoginTestPredicate {
            return { kind: 'lt', column: field, value }
        },
    }
})
vi.mock('@/db', function () {
    return { db: database.db }
})
vi.mock('@/db/schema.ts', function () {
    return schema
})
vi.mock('@simplewebauthn/server', function () {
    return {
        generateAuthenticationOptions: services.generateOptions,
        verifyAuthenticationResponse: services.verify,
    }
})
vi.mock('@/server/Auth/Passkey/config.service.ts', function () {
    return {
        getPasskeyConfig: function () {
            return PASSKEY_CONFIG
        },
    }
})
vi.mock('@/server/Auth/Login/session.service.ts', function () {
    return { createAuthenticatedSessionForUser: services.createSession }
})

vi.mock('@/server/Auth/rejected-authentication.service.ts', () => ({
    recordRejectedAuthenticationService: vi.fn(),
}))
const mockedRejection = recordRejectedAuthenticationService as Mock<
    typeof recordRejectedAuthenticationService
>

function responseFixture(userHandle: unknown = USER_HANDLE) {
    return {
        id: 'Y3JlZGVudGlhbA',
        rawId: 'Y3JlZGVudGlhbA',
        type: 'public-key' as const,
        response: {
            authenticatorData: 'AQID',
            clientDataJSON: 'BAUG',
            signature: 'BwgJ',
            userHandle,
        },
        clientExtensionResults: {},
    }
}

function installLogin(identifier: string | null = null) {
    const user = {
        id: USER_ID,
        username: 'known-user',
        email: 'user@example.test',
        isActive: true,
        isDeleted: false,
        passwordHash: 'synthetic-password-hash',
        isTwoFactorEnabled: false,
    }
    const passkey = {
        id: 'passkey-1',
        userId: USER_ID,
        credentialId: 'Y3JlZGVudGlhbA',
        publicKey: 'AQIDBA',
        webauthnUserId: USER_HANDLE,
        counter: 7,
        transports: ['internal', 'hybrid', ''],
        lastUsedAt: null,
    }
    const challenge = {
        id: CHALLENGE_ID,
        identifier,
        userId: null,
        challenge: 'synthetic-webauthn-challenge',
        type: CHALLENGE_TYPE,
        expiresAt: new Date(Date.now() + 60_000),
    }
    database.state.users = [{ ...user }]
    database.state.passkeys = [{ ...passkey }]
    database.state.challenges = [{ ...challenge }]
    return { user, passkey, challenge }
}

function expectRejectedWithoutSession() {
    expect(mockedRejection.mock.calls).toEqual([
        ['passkey_login', 'invalid_passkey'],
    ])
    expect(services.createSession).not.toHaveBeenCalled()
    expect(database.db.update).not.toHaveBeenCalled()
    expect(database.state.challenges).toEqual([])
}

describe('discoverable passkey login', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        database.state.challenges = []
        database.state.passkeys = []
        database.state.users = []
        database.state.insertedChallenges = []
        database.state.lookupConditions = []
        services.verify.mockResolvedValue({
            verified: true,
            authenticationInfo: { newCounter: 8 },
        })
        services.createSession.mockResolvedValue(SUCCESS)
    })

    it('returns identical discoverable options for known, unknown, empty and omitted usernames without reads', async function () {
        installLogin()
        database.state.challenges = []
        const inputs = [
            { username: 'known-user' },
            { username: 'unknown-user' },
            { username: '' },
            { username: '   ' },
            {},
        ]

        const results = await Promise.all(
            inputs.map(function (input) {
                return beginPasskeyLoginService(input)
            }),
        )

        expect(database.db.select).not.toHaveBeenCalled()
        expect(services.generateOptions).toHaveBeenCalledTimes(inputs.length)
        for (const call of services.generateOptions.mock.calls) {
            expect(call).toEqual([
                {
                    rpID: PASSKEY_CONFIG.rpID,
                    userVerification: 'required',
                },
            ])
        }
        for (const result of results) {
            expect(result.success).toBe(true)
            expect(result.options).toEqual(results[0].options)
            expect(result.options).not.toHaveProperty('allowCredentials')
        }
        expect(
            new Set(
                results.map(function (result) {
                    return result.challengeId
                }),
            ).size,
        ).toBe(inputs.length)
        expect(
            database.state.challenges.map(function (challenge) {
                return challenge.identifier
            }),
        ).toEqual(['known-user', 'unknown-user', null, null, null])
    })

    it('stores only the trimmed optional username binder under the new challenge version', async function () {
        const startedAt = Date.now()
        const result = await beginPasskeyLoginService({
            username: '  unknown-user  ',
        })

        expect(AUTHENTICATION_CHALLENGE_TYPE).toBe(CHALLENGE_TYPE)
        expect(database.db.select).not.toHaveBeenCalled()
        expect(database.state.insertedChallenges).toHaveLength(1)
        const challenge = database.state.insertedChallenges[0]
        expect(challenge).toMatchObject({
            identifier: 'unknown-user',
            challenge: result.options.challenge,
            type: CHALLENGE_TYPE,
        })
        expect(challenge.userId).toBeUndefined()
        expect(challenge.expiresAt).toBeInstanceOf(Date)
        if (!(challenge.expiresAt instanceof Date))
            throw new Error('Missing challenge expiry')
        expect(challenge.expiresAt.getTime()).toBeGreaterThanOrEqual(
            startedAt + 5 * 60_000,
        )
        expect(challenge.expiresAt.getTime()).toBeLessThanOrEqual(
            Date.now() + 5 * 60_000,
        )
    })

    it.each([null, 'known-user'])(
        'verifies the resolved owner and creates a session with binder %j',
        async function (identifier) {
            const fixture = installLogin(identifier)
            const response = responseFixture()

            expect(
                await finishPasskeyLoginService({
                    challengeId: CHALLENGE_ID,
                    response,
                }),
            ).toEqual(SUCCESS)
            expect(database.state.lookupConditions).toEqual([
                {
                    kind: 'eq',
                    column: schema.passkeyCredentials.credentialId,
                    value: response.id,
                },
            ])
            expect(services.verify).toHaveBeenCalledTimes(1)
            expect(services.verify).toHaveBeenCalledWith({
                response,
                expectedChallenge: fixture.challenge.challenge,
                expectedOrigin: PASSKEY_CONFIG.origin,
                expectedRPID: PASSKEY_CONFIG.rpID,
                credential: {
                    id: fixture.passkey.credentialId,
                    publicKey: Buffer.from([1, 2, 3, 4]),
                    counter: 7,
                    transports: ['internal', 'hybrid'],
                },
                requireUserVerification: true,
            })
            expect(database.db.update).not.toHaveBeenCalled()
            expect(services.createSession).toHaveBeenCalledTimes(1)
            expect(services.createSession).toHaveBeenCalledWith({
                user: fixture.user,
                proof: {
                    kind: 'passkey',
                    passkeyId: fixture.passkey.id,
                    counter: 7,
                    newCounter: 8,
                },
                auditAction: 'auth.passkey_login',
                auditMessage:
                    'Benutzer known-user hat sich per Passkey angemeldet.',
            })
            expect(database.state.challenges).toEqual([])
        },
    )

    it.each([
        'unknown credential',
        'missing owner',
        'inactive owner',
        'deleted owner',
    ])(
        'returns the same failure for %s without verification or session',
        async function (reason) {
            installLogin()
            if (reason === 'unknown credential')
                database.state.passkeys[0].credentialId = 'different-credential'
            if (reason === 'missing owner') database.state.users = []
            if (reason === 'inactive owner')
                database.state.users[0].isActive = false
            if (reason === 'deleted owner')
                database.state.users[0].isDeleted = true

            expect(
                await finishPasskeyLoginService({
                    challengeId: CHALLENGE_ID,
                    response: responseFixture(),
                }),
            ).toEqual(FAILURE)
            expect(services.verify).not.toHaveBeenCalled()
            expectRejectedWithoutSession()
        },
    )

    it.each([
        { name: 'missing', value: undefined },
        { name: 'null', value: null },
        { name: 'empty', value: '' },
        { name: 'numeric', value: 123 },
        { name: 'foreign owner', value: 'AwQ' },
        { name: 'padded', value: 'AQI=' },
        { name: 'noncanonical pad bits', value: 'AQJ' },
        { name: 'whitespace', value: ' AQI' },
        { name: 'wrong alphabet', value: '+/8' },
        { name: 'invalid encoding', value: 'A' },
    ])(
        'rejects a $name userHandle with the same failure',
        async function ({ value }) {
            installLogin()
            const response = responseFixture()
            response.response.userHandle = value

            expect(
                await finishPasskeyLoginService({
                    challengeId: CHALLENGE_ID,
                    response,
                }),
            ).toEqual(FAILURE)
            expect(services.verify).not.toHaveBeenCalled()
            expectRejectedWithoutSession()
        },
    )

    it('rejects an owner mismatch even when the response contains another canonical handle', async function () {
        installLogin()
        database.state.passkeys[0].webauthnUserId = 'AwQ'

        expect(
            await finishPasskeyLoginService({
                challengeId: CHALLENGE_ID,
                response: responseFixture(),
            }),
        ).toEqual(FAILURE)
        expect(services.verify).not.toHaveBeenCalled()
        expectRejectedWithoutSession()
    })

    it('checks the username binder only after successful cryptographic verification', async function () {
        installLogin('different-user')

        expect(
            await finishPasskeyLoginService({
                challengeId: CHALLENGE_ID,
                response: responseFixture(),
            }),
        ).toEqual(FAILURE)
        expect(services.verify).toHaveBeenCalledTimes(1)
        expectRejectedWithoutSession()
    })

    it.each(['false', 'throw'])(
        'returns the same failure and creates no session when verification returns %s',
        async function (outcome) {
            installLogin('known-user')
            if (outcome === 'false') {
                services.verify.mockResolvedValueOnce({
                    verified: false,
                    authenticationInfo: { newCounter: 8 },
                })
            } else {
                services.verify.mockRejectedValueOnce(
                    new Error('synthetic invalid signature or origin'),
                )
            }

            expect(
                await finishPasskeyLoginService({
                    challengeId: CHALLENGE_ID,
                    response: responseFixture(),
                }),
            ).toEqual(FAILURE)
            expect(services.verify).toHaveBeenCalledTimes(1)
            expectRejectedWithoutSession()
        },
    )

    it('returns the same failure when atomic session finalization rejects stale credentials', async function () {
        installLogin()
        services.createSession.mockResolvedValueOnce({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: 'Ungültige Anmeldedaten.',
        })
        expect(
            await finishPasskeyLoginService({
                challengeId: CHALLENGE_ID,
                response: responseFixture(),
            }),
        ).toEqual(FAILURE)
        expect(services.verify).toHaveBeenCalledTimes(1)
        expect(services.createSession).toHaveBeenCalledTimes(1)
        expect(database.db.update).not.toHaveBeenCalled()
        expect(database.state.challenges).toEqual([])
        expect(mockedRejection.mock.calls).toEqual([
            ['passkey_login', 'stale_credentials'],
        ])
    })

    it('consumes a challenge exactly once even for simultaneous finish requests', async function () {
        installLogin()
        const input = { challengeId: CHALLENGE_ID, response: responseFixture() }

        const results = await Promise.all([
            finishPasskeyLoginService(input),
            finishPasskeyLoginService(input),
        ])

        expect(
            results.filter(function (result) {
                return result.success
            }),
        ).toHaveLength(1)
        expect(
            results.filter(function (result) {
                return !result.success
            }),
        ).toEqual([EXPIRED])
        expect(services.verify).toHaveBeenCalledTimes(1)
        expect(services.createSession).toHaveBeenCalledTimes(1)
    })

    it('also consumes a rejected challenge so a corrected response cannot retry it', async function () {
        installLogin()
        expect(
            await finishPasskeyLoginService({
                challengeId: CHALLENGE_ID,
                response: responseFixture('AwQ'),
            }),
        ).toEqual(FAILURE)
        expect(
            await finishPasskeyLoginService({
                challengeId: CHALLENGE_ID,
                response: responseFixture(),
            }),
        ).toEqual(EXPIRED)
        expect(services.verify).not.toHaveBeenCalled()
        expect(services.createSession).not.toHaveBeenCalled()
    })

    it.each(['missing', 'expired', 'legacy version', 'registration version'])(
        'rejects a %s challenge before credential lookup',
        async function (reason) {
            installLogin()
            if (reason === 'missing') database.state.challenges = []
            if (reason === 'expired')
                database.state.challenges[0].expiresAt = new Date(
                    Date.now() - 1000,
                )
            if (reason === 'legacy version')
                database.state.challenges[0].type = 'authentication'
            if (reason === 'registration version')
                database.state.challenges[0].type =
                    'registration-reauthenticated-v2'

            expect(
                await finishPasskeyLoginService({
                    challengeId: CHALLENGE_ID,
                    response: responseFixture(),
                }),
            ).toEqual(EXPIRED)
            expect(database.db.select).not.toHaveBeenCalled()
            expect(services.verify).not.toHaveBeenCalled()
            expect(services.createSession).not.toHaveBeenCalled()
            expect(mockedRejection.mock.calls).toEqual([
                ['passkey_login', 'invalid_challenge'],
            ])
        },
    )
    it('does not record successful options or login as a denial', async function () {
        await beginPasskeyLoginService({ username: 'synthetic-user' })
        expect(mockedRejection).not.toHaveBeenCalled()
        installLogin()
        expect(
            (
                await finishPasskeyLoginService({
                    challengeId: CHALLENGE_ID,
                    response: responseFixture(),
                })
            ).success,
        ).toBe(true)
        expect(mockedRejection).not.toHaveBeenCalled()
    })

    it('preserves session storage failure without misclassifying the verified assertion', async function () {
        installLogin()
        const storage = new Error('synthetic private database detail')
        services.createSession.mockRejectedValueOnce(storage)
        await expect(
            finishPasskeyLoginService({
                challengeId: CHALLENGE_ID,
                response: responseFixture(),
            }),
        ).rejects.toBe(storage)
        expect(mockedRejection).not.toHaveBeenCalled()
    })
})
