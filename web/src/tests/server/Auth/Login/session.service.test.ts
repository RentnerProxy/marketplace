import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { createAuthenticatedSessionForUser } from '@/server/Auth/Login/session.service.ts'
import type {
    AuthenticatedLoginProof,
    CreateAuthenticatedSessionInput,
} from '@/server/Auth/Types/login-session.types.ts'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { parseSessionTokenService } from '@/server/Auth/session-token.service.ts'
import {
    SESSION_COOKIE_NAME,
    sessionConfig,
    TRUSTED_DEVICE_COOKIE_NAME,
} from '@/config/session.config.ts'
import type {
    SessionTestColumn,
    SessionTestPredicate,
    SessionTestRow,
    SessionTestScope,
    SessionTestState,
    SessionTestTable,
    SessionTestTables,
    SessionTestTransaction,
} from './session.service.test.types.ts'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const INVALID = {
    success: false as const,
    code: 'INVALID_CREDENTIALS' as const,
    error: 'Ungültige Anmeldedaten.',
}
const META = {
    ip: '198.51.100.2',
    location: 'Synthetic Location',
    device: 'Synthetic Device',
    browser: 'Synthetic Browser',
}
const originalRandomUUID = crypto.randomUUID.bind(crypto)

function column(table: SessionTestTable, field: string): SessionTestColumn {
    return { table, field }
}
const schema = {
    users: { id: column('users', 'id') },
    passkeyCredentials: {
        id: column('passkeyCredentials', 'id'),
        userId: column('passkeyCredentials', 'userId'),
        counter: column('passkeyCredentials', 'counter'),
    },
    sessions: {
        id: column('sessions', 'id'),
        userId: column('sessions', 'userId'),
    },
    trustedDevices: {
        userId: column('trustedDevices', 'userId'),
        deviceTokenHash: column('trustedDevices', 'deviceTokenHash'),
    },
    userPermissions: {
        userId: column('userPermissions', 'userId'),
        permissionId: column('userPermissions', 'permissionId'),
    },
    permissions: {
        id: column('permissions', 'id'),
        key: column('permissions', 'key'),
    },
    twoFactorAuth: {
        id: column('twoFactorAuth', 'id'),
        userId: column('twoFactorAuth', 'userId'),
        verified: column('twoFactorAuth', 'verified'),
    },
}

function tableName(table: unknown): SessionTestTable {
    if (table === schema.users) return 'users'
    if (table === schema.passkeyCredentials) return 'passkeyCredentials'
    if (table === schema.sessions) return 'sessions'
    if (table === schema.trustedDevices) return 'trustedDevices'
    if (table === schema.userPermissions) return 'userPermissions'
    if (table === schema.permissions) return 'permissions'
    if (table === schema.twoFactorAuth) return 'twoFactorAuth'
    throw new Error('Unexpected table in isolated session adapter')
}

function emptyTables(): SessionTestTables {
    return {
        users: [],
        passkeyCredentials: [],
        sessions: [],
        trustedDevices: [],
        userPermissions: [],
        permissions: [],
        twoFactorAuth: [],
        auditLogs: [],
    }
}

function resolveValue(value: unknown, scope: SessionTestScope): unknown {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('table' in value) ||
        !('field' in value) ||
        typeof value.field !== 'string'
    )
        return value
    const table = value.table
    if (
        table !== 'users' &&
        table !== 'passkeyCredentials' &&
        table !== 'sessions' &&
        table !== 'trustedDevices' &&
        table !== 'userPermissions' &&
        table !== 'permissions' &&
        table !== 'twoFactorAuth'
    )
        return value
    return scope[table]?.[value.field]
}

function matches(
    predicate: SessionTestPredicate,
    scope: SessionTestScope,
): boolean {
    return predicate.kind === 'and'
        ? predicate.conditions.every(function (condition) {
              return matches(condition, scope)
          })
        : resolveValue(predicate.column, scope) ===
              resolveValue(predicate.value, scope)
}

function gate() {
    const resolver: { open?: () => void } = {}
    const promise = new Promise<void>(function (resolve) {
        resolver.open = resolve
    })
    return {
        promise,
        open() {
            if (!resolver.open) throw new Error('Uninitialized gate')
            resolver.open()
        },
    }
}

const state: SessionTestState = {
    rows: emptyTables(),
    events: [],
    generatedTokens: [],
    nextTransactionId: 0,
    userLockConditions: [],
    passkeyConditions: [],
    deleteConditions: [],
    insertedRows: [],
    failInsertTable: null,
    failCookieName: null,
    maintenanceActive: false,
    afterUserLock: null,
    beforeMeta: null,
    beforePermissions: null,
    cookies: new Map(),
}
let lockTail = Promise.resolve()

async function acquireUserLock() {
    const previous = lockTail
    const released = gate()
    lockTail = released.promise
    await previous
    return released.open
}

function requireUserLock(transaction: SessionTestTransaction) {
    if (!transaction.userLocked)
        throw new Error(
            'Session side effect happened without SELECT FOR UPDATE',
        )
}

function createTransaction(transaction: SessionTestTransaction) {
    return {
        recordAudit(input: Record<string, unknown>) {
            requireUserLock(transaction)
            const receipt = {
                id: 'audit-' + String(transaction.id),
                createdAt: new Date(),
            }
            transaction.rows.auditLogs.push({ ...input, ...receipt })
            return receipt
        },
        select() {
            return {
                from(table: unknown) {
                    if (table === schema.users) {
                        return {
                            where(predicate: SessionTestPredicate) {
                                return {
                                    limit(count: number) {
                                        return {
                                            async for(mode: string) {
                                                if (mode !== 'update')
                                                    throw new Error(
                                                        'Expected an exclusive user lock',
                                                    )
                                                transaction.releaseLock =
                                                    await acquireUserLock()
                                                transaction.userLocked = true

                                                transaction.rows =
                                                    structuredClone(state.rows)
                                                state.userLockConditions.push(
                                                    predicate,
                                                )
                                                state.events.push(
                                                    'transaction:' +
                                                        transaction.id +
                                                        ':lock',
                                                )
                                                await state.afterUserLock?.()
                                                return transaction.rows.users
                                                    .filter(function (user) {
                                                        return matches(
                                                            predicate,
                                                            { users: user },
                                                        )
                                                    })
                                                    .slice(0, count)
                                                    .map(function (user) {
                                                        return Object.assign(
                                                            {},
                                                            user,
                                                        )
                                                    })
                                            },
                                        }
                                    },
                                }
                            },
                        }
                    }
                    if (table === schema.twoFactorAuth) {
                        return {
                            where(predicate: SessionTestPredicate) {
                                return {
                                    async limit(count: number) {
                                        requireUserLock(transaction)
                                        state.events.push(
                                            'transaction:' +
                                                transaction.id +
                                                ':factor',
                                        )
                                        return transaction.rows.twoFactorAuth
                                            .filter((factor) =>
                                                matches(predicate, {
                                                    twoFactorAuth: factor,
                                                }),
                                            )
                                            .slice(0, count)
                                            .map((factor) => ({
                                                id: factor.id,
                                                verified: factor.verified,
                                            }))
                                    },
                                }
                            },
                        }
                    }
                    if (table !== schema.userPermissions)
                        throw new Error('Unexpected session lookup')
                    return {
                        innerJoin(
                            joinTable: unknown,
                            join: SessionTestPredicate,
                        ) {
                            if (joinTable !== schema.permissions)
                                throw new Error('Unexpected permission join')
                            return {
                                async where(predicate: SessionTestPredicate) {
                                    requireUserLock(transaction)
                                    state.events.push(
                                        'transaction:' +
                                            transaction.id +
                                            ':permissions',
                                    )
                                    await state.beforePermissions?.()
                                    return transaction.rows.userPermissions.flatMap(
                                        function (assignment) {
                                            return transaction.rows.permissions.flatMap(
                                                function (permission) {
                                                    const scope = {
                                                        userPermissions:
                                                            assignment,
                                                        permissions: permission,
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
                                                                  key: permission.key,
                                                              },
                                                          ]
                                                        : []
                                                },
                                            )
                                        },
                                    )
                                },
                            }
                        },
                    }
                },
            }
        },
        update(table: unknown) {
            if (table !== schema.passkeyCredentials)
                throw new Error('Unexpected finalization update')
            return {
                set(values: SessionTestRow) {
                    return {
                        where(predicate: SessionTestPredicate) {
                            return {
                                async returning() {
                                    requireUserLock(transaction)
                                    state.passkeyConditions.push(predicate)
                                    state.events.push(
                                        'transaction:' +
                                            transaction.id +
                                            ':passkey',
                                    )
                                    const updated: Array<{ id: unknown }> = []
                                    transaction.rows.passkeyCredentials =
                                        transaction.rows.passkeyCredentials.map(
                                            function (passkey) {
                                                if (
                                                    !matches(predicate, {
                                                        passkeyCredentials:
                                                            passkey,
                                                    })
                                                )
                                                    return passkey
                                                updated.push({ id: passkey.id })
                                                return Object.assign(
                                                    {},
                                                    passkey,
                                                    values,
                                                )
                                            },
                                        )
                                    return updated
                                },
                            }
                        },
                    }
                },
            }
        },
        delete(table: unknown) {
            const name = tableName(table)
            return {
                async where(predicate: SessionTestPredicate) {
                    requireUserLock(transaction)
                    state.deleteConditions.push({ table: name, predicate })
                    state.events.push(
                        'transaction:' + transaction.id + ':delete:' + name,
                    )
                    transaction.rows[name] = transaction.rows[name].filter(
                        function (row) {
                            return !matches(predicate, { [name]: row })
                        },
                    )
                },
            }
        },
        insert(table: unknown) {
            const name = tableName(table)
            return {
                async values(values: SessionTestRow) {
                    requireUserLock(transaction)
                    state.events.push(
                        'transaction:' + transaction.id + ':insert:' + name,
                    )
                    state.insertedRows.push({
                        table: name,
                        values: structuredClone(values),
                    })
                    if (state.failInsertTable === name)
                        throw new Error('synthetic insert failure: ' + name)
                    transaction.rows[name].push(structuredClone(values))
                },
            }
        },
    }
}

const database = {
    transaction: vi.fn(async function <T>(
        callback: (
            transaction: ReturnType<typeof createTransaction>,
        ) => Promise<T>,
    ): Promise<T> {
        const transaction: SessionTestTransaction = {
            id: ++state.nextTransactionId,
            rows: structuredClone(state.rows),
            userLocked: false,
            releaseLock: null,
        }
        state.events.push('transaction:' + transaction.id + ':begin')
        try {
            const result = await callback(createTransaction(transaction))
            state.rows = transaction.rows
            state.events.push('transaction:' + transaction.id + ':commit')
            return result
        } catch (error) {
            state.events.push('transaction:' + transaction.id + ':rollback')
            throw error
        } finally {
            transaction.releaseLock?.()
        }
    }),
}

const services = {
    getMeta: vi.fn(async function () {
        state.events.push('meta')
        await state.beforeMeta?.()
        return META
    }),
    getMaintenance: vi.fn(async function () {
        state.events.push('maintenance')
        return { isActive: state.maintenanceActive }
    }),
    setCookie: vi.fn(function (
        name: string,
        token: string,
        _options: Record<string, unknown>,
    ) {
        state.events.push('cookie:' + name)
        if (state.failCookieName === name)
            throw new Error('synthetic cookie failure')
        state.cookies.set(name, token)
    }),
    deleteCookie: vi.fn(function (
        name: string,
        _options: Record<string, unknown>,
    ) {
        state.events.push('delete-cookie:' + name)
        state.cookies.delete(name)
    }),
    audit: vi.fn(async function (_input: unknown) {
        state.events.push('audit')
    }),
}

vi.mock('drizzle-orm', function () {
    return {
        eq: function (
            field: SessionTestColumn,
            value: unknown,
        ): SessionTestPredicate {
            return { kind: 'eq', column: field, value }
        },
        and: function (
            ...conditions: Array<SessionTestPredicate>
        ): SessionTestPredicate {
            return { kind: 'and', conditions }
        },
    }
})
vi.mock('@/db', function () {
    return { db: database }
})
vi.mock('@/db/schema.ts', function () {
    return schema
})
vi.mock('@tanstack/react-start/server', function () {
    return {
        setCookie: services.setCookie,
        deleteCookie: services.deleteCookie,
    }
})
vi.mock('@/lib/Request/clientRequestMeta.ts', function () {
    return { getClientRequestMeta: services.getMeta }
})
vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService(actorUserId: string | null) {
            state.events.push('audit-context')
            return { actorUserId, route: null, method: 'POST' }
        },
        async writeAuditLogInTransactionService(
            transaction: ReturnType<typeof createTransaction>,
            input: Record<string, unknown>,
        ) {
            await services.audit(input)
            return transaction.recordAudit(input)
        },
        async publishCommittedAuditLogService() {
            state.events.push('audit-publish')
        },
    }
})
vi.mock('@/server/Maintenance/state.service.ts', function () {
    return { getMaintenanceStateService: services.getMaintenance }
})
vi.mock('@/lib/Permissions/permissions.ts', function () {
    return {
        getDefaultRouteForPermissions: function (keys: Array<string>) {
            return keys.length > 0 ? '/user' : '/login'
        },
        hasPermission: function (keys: Array<string>, key: string) {
            return keys.includes(key)
        },
    }
})

function passwordProof(
    trustThisDevice = false,
    factorId: string | null = 'factor-1',
): AuthenticatedLoginProof {
    return { kind: 'password', trustThisDevice, factorId }
}
function passkeyProof(): AuthenticatedLoginProof {
    return {
        kind: 'passkey',
        passkeyId: 'passkey-1',
        counter: 7,
        newCounter: 8,
    }
}
function inputFixture(
    proof: AuthenticatedLoginProof = passwordProof(),
): CreateAuthenticatedSessionInput {
    return {
        user: {
            id: USER_ID,
            username: 'known-user',
            email: 'user@example.test',
            passwordHash: 'synthetic-verified-password-hash',
            isActive: true,
            isTwoFactorEnabled: true,
        },
        proof,
        auditAction: 'auth.synthetic_login',
        auditMessage: 'Synthetic authenticated login.',
    }
}

function seedExistingCredentials() {
    state.rows.sessions = [
        { id: 'existing-session-hash', userId: USER_ID },
        { id: 'foreign-session-hash', userId: 'different-user' },
    ]
    state.rows.trustedDevices = [
        { deviceTokenHash: 'existing-device-hash', userId: USER_ID },
        { deviceTokenHash: 'foreign-device-hash', userId: 'different-user' },
    ]
}

async function simulatePasswordReset() {
    state.events.push('reset:requested')
    const release = await acquireUserLock()
    try {
        state.events.push('reset:lock')
        state.rows.users[0].passwordHash = 'synthetic-reset-password-hash'
        state.rows.sessions = state.rows.sessions.filter(function (row) {
            return row.userId !== USER_ID
        })
        state.rows.trustedDevices = state.rows.trustedDevices.filter(
            function (row) {
                return row.userId !== USER_ID
            },
        )
        state.events.push('reset:commit')
    } finally {
        release()
    }
}

function expectNoCredentials() {
    expect(state.rows.sessions).toEqual([])
    expect(state.rows.trustedDevices).toEqual([])
    expect(services.setCookie).not.toHaveBeenCalled()
    expect(services.audit).not.toHaveBeenCalled()
}

function expectBefore(first: string, second: string) {
    expect(state.events).toContain(first)
    expect(state.events).toContain(second)
    expect(state.events.indexOf(first)).toBeLessThan(
        state.events.indexOf(second),
    )
}

describe('atomic authenticated session finalization', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        state.rows = emptyTables()
        state.rows.users = [{ ...inputFixture().user, isDeleted: false }]
        state.rows.passkeyCredentials = [
            { id: 'passkey-1', userId: USER_ID, counter: 7 },
        ]
        state.rows.userPermissions = [
            { userId: USER_ID, permissionId: 'permission-1' },
        ]
        state.rows.permissions = [{ id: 'permission-1', key: 'user.synthetic' }]
        state.rows.twoFactorAuth = [
            {
                id: 'factor-1',
                userId: USER_ID,
                verified: true,
                secret: 'synthetic-totp-ciphertext-before',
            },
        ]
        state.events = []
        state.generatedTokens = []
        state.nextTransactionId = 0
        state.userLockConditions = []
        state.passkeyConditions = []
        state.deleteConditions = []
        state.insertedRows = []
        state.failInsertTable = null
        state.failCookieName = null
        state.maintenanceActive = false
        state.afterUserLock = null
        state.beforeMeta = null
        state.beforePermissions = null
        state.cookies = new Map()
        lockTail = Promise.resolve()
        vi.spyOn(crypto, 'randomUUID').mockImplementation(function () {
            const token = originalRandomUUID()
            state.events.push('token')
            state.generatedTokens.push(token)
            return token
        })
    })
    afterEach(function () {
        vi.restoreAllMocks()
    })

    it.each(['password', 'passkey', 'no-permissions'])(
        'rolls back %s finalization when its mandatory audit fails',
        async function (kind) {
            if (kind === 'no-permissions') state.rows.userPermissions = []
            const before = structuredClone(state.rows)
            services.audit.mockRejectedValueOnce(
                new Error('Synthetic audit failure'),
            )
            await expect(
                createAuthenticatedSessionForUser(
                    inputFixture(
                        kind === 'password'
                            ? passwordProof(true)
                            : passkeyProof(),
                    ),
                ),
            ).rejects.toThrow('Synthetic audit failure')
            expect(state.rows).toEqual(before)
            expect(services.setCookie).not.toHaveBeenCalled()
            expect(services.deleteCookie).not.toHaveBeenCalled()
            expect(state.events).toContain('transaction:1:rollback')
            expect(state.events).not.toContain('audit-publish')
            expectBefore('audit-context', 'transaction:1:begin')
        },
    )

    it('rolls back cleanup when its mandatory audit fails and retains the committed creation audit', async function () {
        state.failCookieName = TRUSTED_DEVICE_COOKIE_NAME
        services.audit
            .mockImplementationOnce(async function () {
                state.events.push('audit')
            })
            .mockRejectedValueOnce(new Error('Synthetic cleanup audit failure'))
        await expect(
            createAuthenticatedSessionForUser(
                inputFixture(passwordProof(true)),
            ),
        ).rejects.toThrow('Synthetic cleanup audit failure')
        expect(state.rows.sessions).toHaveLength(1)
        expect(state.rows.trustedDevices).toHaveLength(1)
        expect(state.rows.auditLogs).toHaveLength(1)
        expect(state.rows.auditLogs[0].action).toBe('auth.synthetic_login')
        expect(state.events).toContain('transaction:2:rollback')
        expect(state.cookies.size).toBe(0)
    })

    it('accepts only one independently verified passkey proof with the same old counter', async function () {
        const results = await Promise.all([
            createAuthenticatedSessionForUser(inputFixture(passkeyProof())),
            createAuthenticatedSessionForUser(inputFixture(passkeyProof())),
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
        ).toEqual([INVALID])
        expect(state.rows.sessions).toHaveLength(1)
        expect(state.rows.trustedDevices).toHaveLength(0)
        expect(state.rows.passkeyCredentials[0].counter).toBe(8)
        expect(state.userLockConditions).toHaveLength(2)
        expect(services.setCookie).toHaveBeenCalledTimes(1)
        expect(services.audit).toHaveBeenCalledTimes(1)
    })

    it.each(['deleted', 'counter changed', 'different owner', 'different id'])(
        'creates no session when the locked passkey CAS sees a credential that is %s',
        async function (change) {
            if (change === 'deleted') state.rows.passkeyCredentials = []
            if (change === 'counter changed')
                state.rows.passkeyCredentials[0].counter = 9
            if (change === 'different owner')
                state.rows.passkeyCredentials[0].userId = 'different-user'
            if (change === 'different id')
                state.rows.passkeyCredentials[0].id = 'different-passkey'

            expect(
                await createAuthenticatedSessionForUser(
                    inputFixture(passkeyProof()),
                ),
            ).toEqual(INVALID)
            expectNoCredentials()
            expect(state.events).not.toContain('transaction:1:permissions')
        },
    )

    it('rolls the passkey counter back when session insertion fails', async function () {
        state.failInsertTable = 'sessions'

        await expect(
            createAuthenticatedSessionForUser(inputFixture(passkeyProof())),
        ).rejects.toThrow('synthetic insert failure: sessions')

        expect(state.rows.passkeyCredentials[0].counter).toBe(7)
        expectBefore('transaction:1:passkey', 'transaction:1:rollback')
        expect(state.events).not.toContain('transaction:1:commit')
        expectNoCredentials()
    })

    it('rolls the staged session back when trusted-device insertion fails', async function () {
        state.failInsertTable = 'trustedDevices'

        await expect(
            createAuthenticatedSessionForUser(
                inputFixture(passwordProof(true)),
            ),
        ).rejects.toThrow('synthetic insert failure: trustedDevices')

        expectBefore('transaction:1:insert:sessions', 'transaction:1:rollback')
        expectNoCredentials()
    })

    it.each([false, true])(
        'commits session and requested trusted device before writing cookies (trusted: %s)',
        async function (trust) {
            const input = inputFixture(passwordProof(trust))
            const result = await createAuthenticatedSessionForUser(input)

            expect(result).toEqual({
                success: true,
                redirectTo: '/user',
                user: {
                    id: USER_ID,
                    username: input.user.username,
                    email: input.user.email,
                    isActive: true,
                    permissions: ['user.synthetic'],
                },
            })
            expect(state.userLockConditions).toEqual([
                { kind: 'eq', column: schema.users.id, value: USER_ID },
            ])
            expectBefore('meta', 'transaction:1:begin')
            expectBefore('maintenance', 'transaction:1:begin')
            expect(state.generatedTokens).toHaveLength(trust ? 1 : 0)
            if (trust) expectBefore('transaction:1:permissions', 'token')
            expectBefore('transaction:1:lock', 'transaction:1:permissions')
            expectBefore(
                'transaction:1:insert:sessions',
                'transaction:1:commit',
            )
            expectBefore(
                'transaction:1:commit',
                'cookie:' + SESSION_COOKIE_NAME,
            )
            expect(state.rows.sessions).toHaveLength(1)
            expect(state.rows.trustedDevices).toHaveLength(trust ? 1 : 0)
            const cookie = services.setCookie.mock.calls[0]
            expect(state.rows.sessions[0]).toMatchObject({
                id: await createTokenHash(cookie[1]),
                userId: USER_ID,
                ...META,
                expiresAt: expect.any(Date),
            })
            const sessionToken = parseSessionTokenService(cookie[1])
            if (!sessionToken)
                throw new Error('Expected versioned session cookie')
            expect(state.rows.sessions[0].expiresAt).toEqual(
                new Date(
                    sessionToken.issuedAtMs + sessionConfig.idleDurationMs,
                ),
            )
            expect(cookie[2]).toMatchObject({
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                expires: sessionToken.absoluteExpiresAt,
            })
            expect(JSON.stringify(state.rows)).not.toContain(cookie[1])
            if (trust) {
                const deviceCookie = services.setCookie.mock.calls[1]
                expect(deviceCookie[0]).toBe(TRUSTED_DEVICE_COOKIE_NAME)
                expect(state.rows.trustedDevices[0]).toMatchObject({
                    userId: USER_ID,
                    deviceTokenHash: await createTokenHash(deviceCookie[1]),
                    ...META,
                })
                expectBefore(
                    'transaction:1:insert:trustedDevices',
                    'transaction:1:commit',
                )
                expectBefore(
                    'transaction:1:commit',
                    'cookie:' + TRUSTED_DEVICE_COOKIE_NAME,
                )
            }
            expect(services.audit).toHaveBeenCalledWith({
                action: input.auditAction,
                actorUserId: USER_ID,
                message: input.auditMessage,
                route: null,
                method: 'POST',
            })
        },
    )

    it('starts both deadlines only after user-lock and permission waits finish', async function () {
        const startedAt = Date.parse('2026-09-06T01:00:00.000Z')
        const issuedAt = startedAt + 70 * 60_000
        const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt)
        state.afterUserLock = async function () {
            clock.mockReturnValue(startedAt + 10 * 60_000)
        }
        state.beforePermissions = async function () {
            clock.mockReturnValue(issuedAt)
        }

        expect(
            (
                await createAuthenticatedSessionForUser(
                    inputFixture(passwordProof(true)),
                )
            ).success,
        ).toBe(true)
        const cookie = state.cookies.get(SESSION_COOKIE_NAME)
        const parsed = parseSessionTokenService(cookie)
        expect(parsed?.issuedAtMs).toBe(issuedAt)
        expect(state.rows.sessions[0].expiresAt).toEqual(
            new Date(issuedAt + sessionConfig.idleDurationMs),
        )
        expect(services.setCookie.mock.calls[0][2].expires).toEqual(
            new Date(issuedAt + sessionConfig.absoluteDurationMs),
        )
        expectBefore('transaction:1:permissions', 'token')
        expectBefore('transaction:1:commit', 'cookie:' + SESSION_COOKIE_NAME)
    })

    it('compares passkey id, owner and prior counter inside the same user-locked transaction', async function () {
        expect(
            (
                await createAuthenticatedSessionForUser(
                    inputFixture(passkeyProof()),
                )
            ).success,
        ).toBe(true)

        expect(state.passkeyConditions).toEqual([
            {
                kind: 'and',
                conditions: [
                    {
                        kind: 'eq',
                        column: schema.passkeyCredentials.id,
                        value: 'passkey-1',
                    },
                    {
                        kind: 'eq',
                        column: schema.passkeyCredentials.userId,
                        value: USER_ID,
                    },
                    {
                        kind: 'eq',
                        column: schema.passkeyCredentials.counter,
                        value: 7,
                    },
                ],
            },
        ])
        expectBefore('transaction:1:lock', 'transaction:1:passkey')
        expectBefore('transaction:1:passkey', 'transaction:1:permissions')
        expectBefore('transaction:1:insert:sessions', 'transaction:1:commit')
    })

    it.each(
        ['password', 'passkey'].flatMap(function (kind) {
            return [
                'missing',
                'inactive',
                'deleted',
                'password changed',
                'email changed',
                'username changed',
            ].map(function (change) {
                return { kind, change }
            })
        }),
    )(
        'rejects a $kind snapshot when the current user is $change',
        async function ({ kind, change }) {
            if (change === 'missing') state.rows.users = []
            if (change === 'inactive') state.rows.users[0].isActive = false
            if (change === 'deleted') state.rows.users[0].isDeleted = true
            if (change === 'password changed')
                state.rows.users[0].passwordHash = 'different-hash'
            if (change === 'email changed')
                state.rows.users[0].email = 'changed@example.test'
            if (change === 'username changed')
                state.rows.users[0].username = 'changed-user'

            expect(
                await createAuthenticatedSessionForUser(
                    inputFixture(
                        kind === 'password'
                            ? passwordProof(true)
                            : passkeyProof(),
                    ),
                ),
            ).toEqual(INVALID)
            expect(state.passkeyConditions).toEqual([])
            expectNoCredentials()
        },
    )

    it.each([
        { previous: false, current: true },
        { previous: true, current: false },
    ])(
        'rejects a changed MFA flag from $previous to $current',
        async function ({ previous, current }) {
            const input = inputFixture(passwordProof(true))
            input.user.isTwoFactorEnabled = previous
            state.rows.users[0].isTwoFactorEnabled = current

            expect(await createAuthenticatedSessionForUser(input)).toEqual(
                INVALID,
            )
            expectNoCredentials()
        },
    )

    it.each(['replaced', 'missing', 'unverified', 'different owner'])(
        'rejects a password proof whose current MFA factor is %s',
        async function (change) {
            if (change === 'replaced')
                state.rows.twoFactorAuth[0].id = 'factor-2'
            if (change === 'missing') state.rows.twoFactorAuth = []
            if (change === 'unverified')
                state.rows.twoFactorAuth[0].verified = false
            if (change === 'different owner')
                state.rows.twoFactorAuth[0].userId = 'foreign-user'
            expect(
                await createAuthenticatedSessionForUser(
                    inputFixture(passwordProof(true)),
                ),
            ).toEqual(INVALID)
            expectBefore('transaction:1:lock', 'transaction:1:factor')
            expect(state.events).not.toContain('transaction:1:permissions')
            expectNoCredentials()
        },
    )

    it.each([null, 'different-factor'])(
        'rejects an MFA proof with an absent or mismatched version %s',
        async function (factorId) {
            expect(
                await createAuthenticatedSessionForUser(
                    inputFixture(passwordProof(false, factorId)),
                ),
            ).toEqual(INVALID)
            expectNoCredentials()
        },
    )

    it.each([false, true])(
        'accepts a password-only proof while a setup is pending: %s',
        async function (pending) {
            const input = inputFixture(passwordProof(false, null))
            input.user.isTwoFactorEnabled = false
            state.rows.users[0].isTwoFactorEnabled = false
            state.rows.twoFactorAuth = pending
                ? [{ id: 'pending-factor', userId: USER_ID, verified: false }]
                : []
            expect(
                (await createAuthenticatedSessionForUser(input)).success,
            ).toBe(true)
            expect(state.rows.sessions).toHaveLength(1)
            expect(state.rows.trustedDevices).toEqual([])
            expectBefore(
                'transaction:1:factor',
                'transaction:1:insert:sessions',
            )
        },
    )

    it('rejects a verified factor that contradicts the current disabled MFA flag', async function () {
        const input = inputFixture(passwordProof(false, null))
        input.user.isTwoFactorEnabled = false
        state.rows.users[0].isTwoFactorEnabled = false
        expect(await createAuthenticatedSessionForUser(input)).toEqual(INVALID)
        expectNoCredentials()
    })

    it('does not create a trusted device from a proof without active MFA', async function () {
        const input = inputFixture(passwordProof(true, null))
        input.user.isTwoFactorEnabled = false
        state.rows.users[0].isTwoFactorEnabled = false
        state.rows.twoFactorAuth = []
        expect(await createAuthenticatedSessionForUser(input)).toEqual(INVALID)
        expectNoCredentials()
    })

    it.each([false, true])(
        'rejects a factor replacement committed after verification but before the user lock (new trust: %s)',
        async function (trust) {
            const metaEntered = gate()
            const continueMeta = gate()
            state.beforeMeta = async function () {
                metaEntered.open()
                await continueMeta.promise
            }
            const finalization = createAuthenticatedSessionForUser(
                inputFixture(passwordProof(trust)),
            )
            await metaEntered.promise
            const release = await acquireUserLock()
            try {
                state.rows.twoFactorAuth = [
                    {
                        id: 'replacement-factor',
                        userId: USER_ID,
                        verified: true,
                        secret: 'replacement-secret',
                    },
                ]
                state.events.push('factor-replacement:commit')
            } finally {
                release()
            }
            continueMeta.open()
            expect(await finalization).toEqual(INVALID)
            expectBefore('factor-replacement:commit', 'transaction:1:lock')
            expectNoCredentials()
        },
    )

    it('allows an unchanged active MFA snapshot after another valid use rotates its encrypted TOTP state', async function () {
        state.rows.twoFactorAuth[0].secret =
            'synthetic-totp-ciphertext-after-consumption'

        expect(
            (
                await createAuthenticatedSessionForUser(
                    inputFixture(passwordProof(true)),
                )
            ).success,
        ).toBe(true)
        expect(state.rows.sessions).toHaveLength(1)
        expect(state.rows.trustedDevices).toHaveLength(1)
    })

    it('rejects finalization when a reset commits while request metadata is still being prepared', async function () {
        seedExistingCredentials()
        const metaEntered = gate()
        const continueMeta = gate()
        state.beforeMeta = async function () {
            metaEntered.open()
            await continueMeta.promise
        }
        const finalization = createAuthenticatedSessionForUser(
            inputFixture(passwordProof(true)),
        )
        await metaEntered.promise
        await simulatePasswordReset()
        continueMeta.open()

        expect(await finalization).toEqual(INVALID)
        expectBefore('reset:commit', 'transaction:1:lock')
        expect(state.rows.sessions).toEqual([
            { id: 'foreign-session-hash', userId: 'different-user' },
        ])
        expect(state.rows.trustedDevices).toEqual([
            {
                deviceTokenHash: 'foreign-device-hash',
                userId: 'different-user',
            },
        ])
        expect(services.setCookie).not.toHaveBeenCalled()
        expect(services.audit).not.toHaveBeenCalled()
    })

    it('makes a later reset wait for the user lock and revoke the newly committed session and device', async function () {
        const lockHeld = gate()
        const continueFinalization = gate()
        state.afterUserLock = async function () {
            lockHeld.open()
            await continueFinalization.promise
        }
        const finalization = createAuthenticatedSessionForUser(
            inputFixture(passwordProof(true)),
        )
        await lockHeld.promise
        const reset = simulatePasswordReset()
        await Promise.resolve()
        expect(state.events).not.toContain('reset:lock')
        expect(state.rows.sessions).toEqual([])
        expect(services.setCookie).not.toHaveBeenCalled()
        continueFinalization.open()

        const [result] = await Promise.all([finalization, reset])

        expect(result.success).toBe(true)
        expectBefore('transaction:1:commit', 'reset:lock')
        expectBefore('transaction:1:insert:trustedDevices', 'reset:commit')
        expect(state.rows.sessions).toEqual([])
        expect(state.rows.trustedDevices).toEqual([])
        expect(state.rows.users[0].passwordHash).toBe(
            'synthetic-reset-password-hash',
        )
    })

    it.each([SESSION_COOKIE_NAME, TRUSTED_DEVICE_COOKIE_NAME])(
        'removes only the new login hashes when cookie %s fails',
        async function (failedCookie) {
            seedExistingCredentials()
            const existingSessions = structuredClone(state.rows.sessions)
            const existingDevices = structuredClone(state.rows.trustedDevices)
            state.cookies.set('unrelated_cookie', 'preserved')
            state.failCookieName = failedCookie

            await expect(
                createAuthenticatedSessionForUser(
                    inputFixture(passwordProof(true)),
                ),
            ).rejects.toThrow('synthetic cookie failure')

            expect(state.rows.sessions).toEqual(existingSessions)
            expect(state.rows.trustedDevices).toEqual(existingDevices)
            expect(database.transaction).toHaveBeenCalledTimes(2)
            expectBefore('transaction:2:lock', 'transaction:2:delete:sessions')
            expectBefore(
                'transaction:2:delete:trustedDevices',
                'transaction:2:commit',
            )
            expectBefore('transaction:1:commit', 'cookie:' + failedCookie)
            expect(state.deleteConditions).toEqual([
                {
                    table: 'sessions',
                    predicate: {
                        kind: 'and',
                        conditions: [
                            {
                                kind: 'eq',
                                column: schema.sessions.id,
                                value: state.insertedRows[0].values.id,
                            },
                            {
                                kind: 'eq',
                                column: schema.sessions.userId,
                                value: USER_ID,
                            },
                        ],
                    },
                },
                {
                    table: 'trustedDevices',
                    predicate: {
                        kind: 'and',
                        conditions: [
                            {
                                kind: 'eq',
                                column: schema.trustedDevices.userId,
                                value: USER_ID,
                            },
                            {
                                kind: 'eq',
                                column: schema.trustedDevices.deviceTokenHash,
                                value: state.insertedRows[1].values
                                    .deviceTokenHash,
                            },
                        ],
                    },
                },
            ])
            expect(services.deleteCookie).toHaveBeenCalledWith(
                SESSION_COOKIE_NAME,
                { path: '/' },
            )
            expect(services.deleteCookie).toHaveBeenCalledWith(
                TRUSTED_DEVICE_COOKIE_NAME,
                { path: '/' },
            )
            expect(state.cookies).toEqual(
                new Map([['unrelated_cookie', 'preserved']]),
            )
            expect(services.audit).toHaveBeenCalledTimes(2)
            expect(state.rows.auditLogs.map((row) => row.action)).toEqual([
                'auth.synthetic_login',
                'auth.login_session_cancelled',
            ])
            expectBefore('audit', 'transaction:1:commit')
            expectBefore('transaction:1:commit', 'audit-publish')
        },
    )

    it('retains the committed passkey counter while cleaning up a failed session cookie', async function () {
        seedExistingCredentials()
        state.failCookieName = SESSION_COOKIE_NAME

        await expect(
            createAuthenticatedSessionForUser(inputFixture(passkeyProof())),
        ).rejects.toThrow('synthetic cookie failure')

        expect(state.rows.passkeyCredentials[0].counter).toBe(8)
        expect(state.rows.sessions).toHaveLength(2)
        expect(state.rows.trustedDevices).toHaveLength(2)
        expect(state.deleteConditions).toHaveLength(1)
        expect(services.deleteCookie).not.toHaveBeenCalledWith(
            TRUSTED_DEVICE_COOKIE_NAME,
            expect.anything(),
        )
    })

    it('keeps the no-permission result free of sessions and trusted devices', async function () {
        state.rows.userPermissions = []

        const result = await createAuthenticatedSessionForUser(
            inputFixture(passwordProof(true)),
        )

        expect(result).toMatchObject({
            success: true,
            redirectTo: '/login',
            loggedOutDueToMissingPermissions: true,
        })
        expect(state.rows.sessions).toEqual([])
        expect(state.rows.trustedDevices).toEqual([])
        expect(services.setCookie).not.toHaveBeenCalled()
        expect(services.deleteCookie).toHaveBeenCalledWith(
            SESSION_COOKIE_NAME,
            { path: '/' },
        )
        expect(services.audit).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'auth.login_without_permissions',
                actorUserId: USER_ID,
            }),
        )
    })

    it('uses current permissions under the lock and keeps maintenance routing intact', async function () {
        state.maintenanceActive = true

        expect(
            await createAuthenticatedSessionForUser(inputFixture()),
        ).toMatchObject({ success: true, redirectTo: '/maintenance' })
        expectBefore('transaction:1:lock', 'transaction:1:permissions')
        expect(state.rows.sessions).toHaveLength(1)
    })
})
