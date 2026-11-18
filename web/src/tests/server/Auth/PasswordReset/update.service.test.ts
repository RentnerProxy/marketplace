import type { SecurityChangeMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'
const enqueueSecurityChange = vi.fn(async function (
    _input: SecurityChangeMailInput,
) {})
vi.mock('@/server/Queues/mail.queue.ts', () => ({
    enqueueSecurityChangeMail: enqueueSecurityChange,
}))
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    setSystemTime,
    vi,
} from 'bun:test'
import type {
    PasswordResetTestFailure,
    PasswordResetTestPredicate,
    PasswordResetTestRow,
    PasswordResetTestState,
    PasswordResetTestTable,
    PasswordResetTestTables,
} from './update.service.test.types.ts'

const NOW = new Date('2026-09-05T12:00:00.000Z')
const USER_ID = 'reset-user'
const OTHER_USER_ID = 'other-user'
const INPUT = { token: 'synthetic-reset-token', password: 'new' }
const INVALID_TOKEN = {
    success: false as const,
    error: 'Ungültiger oder abgelaufener Token.',
}
const schema = {
    users: {
        id: 'users.id',
        username: 'users.username',
        email: 'users.email',
        passwordHash: 'users.passwordHash',
        isActive: 'users.isActive',
        isDeleted: 'users.isDeleted',
    },
    passwordResetTokens: {
        userId: 'passwordResetTokens.userId',
        tokenHash: 'passwordResetTokens.tokenHash',
        expiresAt: 'passwordResetTokens.expiresAt',
    },
    sessions: { userId: 'sessions.userId' },
    trustedDevices: { userId: 'trustedDevices.userId' },
}
const tableNames = [
    'users',
    'passwordResetTokens',
    'sessions',
    'trustedDevices',
] as const

function createGate() {
    const gate: { resolve: (() => void) | null } = { resolve: null }
    const promise = new Promise<void>(function (resolve) {
        gate.resolve = resolve
    })
    return {
        promise,
        release() {
            gate.resolve?.()
        },
    }
}

function initialTables(): PasswordResetTestTables {
    return {
        auditLogs: [],
        users: [USER_ID, OTHER_USER_ID].map(function (id) {
            return {
                id,
                username: id + '-name',
                email: id + '@example.test',
                emailVerifiedAt: null,
                passwordHash: 'previous-password-hash',
                isActive: true,
                isDeleted: false,
            }
        }),
        passwordResetTokens: [
            {
                userId: USER_ID,
                tokenHash: 'hash:' + INPUT.token,
                expiresAt: new Date(NOW.getTime() + 60_000),
            },
            {
                userId: OTHER_USER_ID,
                tokenHash: 'hash:other-token',
                expiresAt: new Date(NOW.getTime() + 60_000),
            },
        ],
        sessions: [
            { id: 'session-one', userId: USER_ID },
            { id: 'session-two', userId: USER_ID },
            { id: 'other-session', userId: OTHER_USER_ID },
        ],
        trustedDevices: [
            { id: 'trusted-device', userId: USER_ID },
            { id: 'other-trusted-device', userId: OTHER_USER_ID },
        ],
    }
}

function tableName(table: unknown): PasswordResetTestTable {
    for (const name of tableNames) {
        if (table === schema[name]) return name
    }
    throw new Error('Unexpected synthetic database table')
}

function matches(
    table: PasswordResetTestTable,
    row: PasswordResetTestRow,
    predicate: PasswordResetTestPredicate,
): boolean {
    if (predicate.kind === 'and') {
        return predicate.conditions.every(function (condition) {
            return matches(table, row, condition)
        })
    }
    if (!predicate.column.startsWith(table + '.')) {
        throw new Error('Synthetic predicate references another table')
    }
    const value = row[predicate.column.slice(table.length + 1)]
    if (predicate.kind === 'eq') return value === predicate.value
    return value instanceof Date && value.getTime() > predicate.value.getTime()
}

function project(
    rows: Array<PasswordResetTestRow>,
    selection: Record<string, string>,
) {
    return rows.map(function (row) {
        return Object.fromEntries(
            Object.entries(selection).map(function ([key, column]) {
                return [key, row[column.slice(column.indexOf('.') + 1)]]
            }),
        )
    })
}

const database = (function () {
    const state: PasswordResetTestState = {
        tables: initialTables(),
        events: [],
        beforePasswordHash: null,
        onLockRequested: null,
        failAt: null,
        transactionCount: 0,
    }
    let lockTail = Promise.resolve()

    async function acquireUserLock() {
        const previous = lockTail
        const gate = createGate()
        lockTail = gate.promise
        await previous
        return gate.release
    }

    function failAt(phase: PasswordResetTestFailure) {
        if (state.failAt === phase) {
            throw new Error('Synthetic ' + phase + ' failure')
        }
    }

    const db = {
        select(selection: Record<string, string>) {
            return {
                from(table: unknown) {
                    if (tableName(table) !== 'passwordResetTokens') {
                        throw new Error('Unexpected unlocked synthetic read')
                    }
                    return {
                        where(condition: PasswordResetTestPredicate) {
                            return {
                                async limit(count: number) {
                                    state.events.push('token-lookup')
                                    return project(
                                        state.tables.passwordResetTokens
                                            .filter(function (row) {
                                                return matches(
                                                    'passwordResetTokens',
                                                    row,
                                                    condition,
                                                )
                                            })
                                            .slice(0, count),
                                        selection,
                                    )
                                },
                            }
                        },
                    }
                },
            }
        },
        async transaction(
            callback: (transaction: unknown) => Promise<unknown>,
        ) {
            const prefix = 'tx-' + ++state.transactionCount + ':'
            let working: PasswordResetTestTables | null = null
            const lock: { release: (() => void) | null } = { release: null }

            function lockedTables() {
                if (!working) {
                    throw new Error('Mutation attempted before user lock')
                }
                return working
            }

            const transaction = {
                recordAudit(input: Record<string, unknown>) {
                    failAt('audit')
                    const receipt = {
                        id: prefix + 'audit',
                        createdAt: new Date(),
                    }
                    lockedTables().auditLogs.push({ ...input, ...receipt })
                    return receipt
                },
                select(selection: Record<string, string>) {
                    return {
                        from(table: unknown) {
                            if (tableName(table) !== 'users') {
                                throw new Error('Expected user lock first')
                            }
                            return {
                                where(condition: PasswordResetTestPredicate) {
                                    return {
                                        limit(count: number) {
                                            return {
                                                async for(mode: string) {
                                                    if (mode !== 'update') {
                                                        throw new Error(
                                                            'Expected FOR UPDATE',
                                                        )
                                                    }
                                                    state.events.push(
                                                        prefix +
                                                            'lock-requested',
                                                    )
                                                    state.onLockRequested?.()
                                                    lock.release =
                                                        await acquireUserLock()

                                                    working = structuredClone(
                                                        state.tables,
                                                    )
                                                    state.events.push(
                                                        prefix + 'user-locked',
                                                    )
                                                    return project(
                                                        working.users
                                                            .filter(
                                                                function (row) {
                                                                    return matches(
                                                                        'users',
                                                                        row,
                                                                        condition,
                                                                    )
                                                                },
                                                            )
                                                            .slice(0, count),
                                                        selection,
                                                    )
                                                },
                                            }
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
                        where(condition: PasswordResetTestPredicate) {
                            function execute() {
                                const tables = lockedTables()
                                state.events.push(prefix + name + '-delete')
                                if (name === 'sessions')
                                    failAt('sessions-delete')
                                if (name === 'trustedDevices')
                                    failAt('trustedDevices-delete')
                                const removed = tables[name].filter(
                                    function (row) {
                                        return matches(name, row, condition)
                                    },
                                )
                                tables[name] = tables[name].filter(
                                    function (row) {
                                        return !matches(name, row, condition)
                                    },
                                )
                                return removed
                            }
                            if (name === 'passwordResetTokens') {
                                return {
                                    async returning(
                                        selection: Record<string, string>,
                                    ) {
                                        return project(execute(), selection)
                                    },
                                }
                            }
                            return (async function () {
                                execute()
                            })()
                        },
                    }
                },
                update(table: unknown) {
                    if (tableName(table) !== 'users') {
                        throw new Error('Unexpected synthetic update table')
                    }
                    return {
                        set(values: { passwordHash: string }) {
                            return {
                                where(condition: PasswordResetTestPredicate) {
                                    return {
                                        async returning(
                                            selection: Record<string, string>,
                                        ) {
                                            const tables = lockedTables()
                                            state.events.push(
                                                prefix + 'password-update',
                                            )
                                            failAt('password-update')
                                            if (
                                                state.failAt ===
                                                'empty-password-update'
                                            )
                                                return []
                                            const changed: Array<PasswordResetTestRow> =
                                                []
                                            tables.users = tables.users.map(
                                                function (row) {
                                                    if (
                                                        !matches(
                                                            'users',
                                                            row,
                                                            condition,
                                                        )
                                                    )
                                                        return row
                                                    const updated =
                                                        Object.assign(
                                                            row,
                                                            values,
                                                        )
                                                    changed.push(updated)
                                                    return updated
                                                },
                                            )
                                            return project(changed, selection)
                                        },
                                    }
                                },
                            }
                        },
                    }
                },
            }

            try {
                const result = await callback(transaction)
                failAt('commit')
                if (working) state.tables = working
                state.events.push(prefix + 'commit')
                return result
            } catch (error) {
                state.events.push(prefix + 'rollback')
                throw error
            } finally {
                lock.release?.()
            }
        },
    }

    return {
        db,
        state,
        acquireUserLock,
        reset() {
            state.tables = initialTables()
            state.events = []
            state.beforePasswordHash = null
            state.onLockRequested = null
            state.failAt = null
            state.transactionCount = 0
            lockTail = Promise.resolve()
        },
    }
})()

const services = {
    publish: vi.fn(async function () {
        database.state.events.push('realtime')
    }),
    audit: vi.fn(async function (_input: unknown) {
        database.state.events.push('audit')
    }),
    issueGrant: vi.fn(async function (_input: unknown) {
        database.state.events.push('recovery-grant')
    }),
    logError: vi.fn(),
    logWarn: vi.fn(),
}

vi.mock('drizzle-orm', function () {
    return {
        and(...conditions: Array<PasswordResetTestPredicate>) {
            return { kind: 'and', conditions }
        },
        eq(column: string, value: unknown) {
            return { kind: 'eq', column, value }
        },
        gt(column: string, value: Date) {
            return { kind: 'gt', column, value }
        },
    }
})
vi.mock('@/db', function () {
    return { db: database.db }
})
vi.mock('@/db/schema.ts', function () {
    return schema
})
vi.mock('@/lib/Auth/tokens.ts', function () {
    return {
        async createTokenHash(token: string) {
            return 'hash:' + token
        },
    }
})
vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService(actorUserId: string | null) {
            database.state.events.push('audit-context')
            return { actorUserId, route: null, method: 'POST' }
        },
        async writeAuditLogInTransactionService(
            transaction: {
                recordAudit(input: Record<string, unknown>): {
                    id: string
                    createdAt: Date
                }
            },
            input: Record<string, unknown>,
        ) {
            await services.audit(input)
            return transaction.recordAudit(input)
        },
        async publishCommittedAuditLogService() {
            database.state.events.push('audit-publish')
        },
    }
})
vi.mock('@/server/Realtime/publish.service.ts', function () {
    return { publishUserSessionsRevokedService: services.publish }
})
vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: services.logError, logWarn: services.logWarn }
})
vi.mock('@/server/Auth/Login/recovery.service.ts', function () {
    return { issueLoginRecoveryGrantService: services.issueGrant }
})

const { updatePasswordByTokenService } =
    await import('@/server/Auth/PasswordReset/update.service.ts')

function pauseHashing(expectedCalls = 1) {
    let calls = 0
    const entered = createGate()
    const resume = createGate()
    database.state.beforePasswordHash = async function () {
        if (++calls === expectedCalls) entered.release()
        await resume.promise
    }
    return { entered: entered.promise, resume: resume.release }
}

function expectNoCompletionEffects() {
    expect(enqueueSecurityChange).not.toHaveBeenCalled()
    expect(services.publish).not.toHaveBeenCalled()
    expect(database.state.tables.auditLogs).toEqual([])
    expect(database.state.events).not.toContain('audit-publish')
    expect(services.issueGrant).not.toHaveBeenCalled()
}

function expectOnlyOtherUserAuthState() {
    for (const table of [
        'passwordResetTokens',
        'sessions',
        'trustedDevices',
    ] as const) {
        expect(database.state.tables[table]).toEqual(
            initialTables()[table].filter(function (row) {
                return row.userId === OTHER_USER_ID
            }),
        )
    }
}

describe('password reset completion transaction', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        vi.useFakeTimers()
        setSystemTime(NOW)
        database.reset()
        vi.spyOn(Bun.password, 'hash').mockImplementation(
            async function (password) {
                database.state.events.push('password-hash')
                await database.state.beforePasswordHash?.()
                return 'hashed:' + String(password)
            },
        )
    })

    afterEach(function () {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('locks the user before consuming the token and atomically revokes only that user', async function () {
        expect(await updatePasswordByTokenService(INPUT)).toEqual({
            success: true,
        })
        expect(Bun.password.hash).toHaveBeenCalledWith(INPUT.password)
        expect(database.state.tables.users).toEqual([
            {
                ...initialTables().users[0],
                passwordHash: 'hashed:new',
                emailVerifiedAt: NOW,
            },
            initialTables().users[1],
        ])
        expectOnlyOtherUserAuthState()
        const events = database.state.events
        expect(events.indexOf('password-hash')).toBeLessThan(
            events.indexOf('tx-1:user-locked'),
        )
        expect(events.indexOf('tx-1:user-locked')).toBeLessThan(
            events.indexOf('tx-1:passwordResetTokens-delete'),
        )
        expect(events.indexOf('tx-1:commit')).toBeLessThan(
            events.indexOf('realtime'),
        )
        expect(events.indexOf('audit')).toBeLessThan(
            events.indexOf('tx-1:commit'),
        )
        expect(events.indexOf('tx-1:commit')).toBeLessThan(
            events.indexOf('audit-publish'),
        )
        expect(events.indexOf('audit-context')).toBeLessThan(
            events.indexOf('tx-1:user-locked'),
        )
        expect(database.state.tables.auditLogs).toHaveLength(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(enqueueSecurityChange).toHaveBeenCalledWith({
            to: USER_ID + '@example.test',
            change: 'password_changed',
            changedAt: NOW.toISOString(),
            auditEventId: 'tx-1:audit',
        })
        expect(services.publish).toHaveBeenCalledWith({
            userId: USER_ID,
            revokedAt: NOW.toISOString(),
        })
        expect(services.audit).toHaveBeenCalledWith({
            action: 'auth.password_updated_by_token',
            actorUserId: USER_ID,
            message: 'Passwort wurde über Reset-Token geändert.',
            route: null,
            method: 'POST',
        })
        expect(services.issueGrant).toHaveBeenCalledWith({
            userId: USER_ID,
            username: USER_ID + '-name',
            passwordHash: 'hashed:new',
        })
        expect(events).toContain('recovery-grant')
        expect(events.indexOf('realtime')).toBeLessThan(
            events.indexOf('recovery-grant'),
        )
        expect(events.indexOf('audit')).toBeLessThan(
            events.indexOf('recovery-grant'),
        )
    })

    it.each(['missing', 'expired'])(
        'rejects an initially %s token before password hashing or any transaction',
        async function (condition) {
            if (condition === 'missing')
                database.state.tables.passwordResetTokens.shift()
            else database.state.tables.passwordResetTokens[0].expiresAt = NOW
            const before = structuredClone(database.state.tables)
            expect(await updatePasswordByTokenService(INPUT)).toEqual(
                INVALID_TOKEN,
            )
            expect(database.state.tables).toEqual(before)
            expect(Bun.password.hash).not.toHaveBeenCalled()
            expect(database.state.transactionCount).toBe(0)
            expectNoCompletionEffects()
        },
    )

    it('consumes the token exactly once when both requests looked it up before either transaction', async function () {
        const hashing = pauseHashing(2)
        const first = updatePasswordByTokenService(INPUT)
        const second = updatePasswordByTokenService(INPUT)
        await hashing.entered
        hashing.resume()
        const results = await Promise.all([first, second])
        expect(
            results.filter(function (result) {
                return result.success
            }),
        ).toEqual([{ success: true }])
        expect(
            results.filter(function (result) {
                return !result.success
            }),
        ).toEqual([INVALID_TOKEN])
        expect(Bun.password.hash).toHaveBeenCalledTimes(2)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(database.state.transactionCount).toBe(2)
        expectOnlyOtherUserAuthState()
        expect(services.publish).toHaveBeenCalledTimes(1)
        expect(services.audit).toHaveBeenCalledTimes(1)
        expect(services.issueGrant).toHaveBeenCalledTimes(1)
    })

    it('rejects a consumed token on a later request without hashing again', async function () {
        expect(await updatePasswordByTokenService(INPUT)).toEqual({
            success: true,
        })
        expect(await updatePasswordByTokenService(INPUT)).toEqual(INVALID_TOKEN)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(Bun.password.hash).toHaveBeenCalledTimes(1)
        expect(services.audit).toHaveBeenCalledTimes(1)
        expect(services.issueGrant).toHaveBeenCalledTimes(1)
    })

    it('preserves a replacement token issued while the new password was being hashed', async function () {
        const hashing = pauseHashing()
        const pending = updatePasswordByTokenService(INPUT)
        await hashing.entered
        database.state.tables.passwordResetTokens[0].tokenHash =
            'hash:replacement-token'
        const before = structuredClone(database.state.tables)
        hashing.resume()
        expect(await pending).toEqual(INVALID_TOKEN)
        expect(database.state.tables).toEqual(before)
        expectNoCompletionEffects()
    })

    it('binds final token consumption to the exact user from the initial lookup', async function () {
        const hashing = pauseHashing()
        const pending = updatePasswordByTokenService(INPUT)
        await hashing.entered
        database.state.tables.passwordResetTokens[0].userId = OTHER_USER_ID
        const before = structuredClone(database.state.tables)
        hashing.resume()
        expect(await pending).toEqual(INVALID_TOKEN)
        expect(database.state.tables).toEqual(before)
        expectNoCompletionEffects()
    })

    it('checks expiry again at consumption time instead of reusing lookup time', async function () {
        const hashing = pauseHashing()
        const pending = updatePasswordByTokenService(INPUT)
        await hashing.entered
        setSystemTime(new Date(NOW.getTime() + 60_000))
        const before = structuredClone(database.state.tables)
        hashing.resume()
        expect(await pending).toEqual(INVALID_TOKEN)
        expect(database.state.tables).toEqual(before)
        expectNoCompletionEffects()
    })

    it.each(['missing', 'inactive', 'deleted'])(
        'rejects a user made %s after token lookup without consuming the token',
        async function (change) {
            const hashing = pauseHashing()
            const pending = updatePasswordByTokenService(INPUT)
            await hashing.entered
            if (change === 'missing') database.state.tables.users.shift()
            if (change === 'inactive')
                database.state.tables.users[0].isActive = false
            if (change === 'deleted')
                database.state.tables.users[0].isDeleted = true
            const before = structuredClone(database.state.tables)
            hashing.resume()
            expect(await pending).toEqual(INVALID_TOKEN)
            expect(database.state.tables).toEqual(before)
            expect(database.state.events).not.toContain(
                'tx-1:passwordResetTokens-delete',
            )
            expectNoCompletionEffects()
        },
    )

    it('waits for the user lock before reading current state or touching the token', async function () {
        const releaseOtherTransaction = await database.acquireUserLock()
        const requested = createGate()
        database.state.onLockRequested = requested.release
        const before = structuredClone(database.state.tables)
        const pending = updatePasswordByTokenService(INPUT)
        await requested.promise
        expect(database.state.tables).toEqual(before)
        expect(database.state.events).not.toContain(
            'tx-1:passwordResetTokens-delete',
        )
        database.state.tables.users[0].isActive = false
        releaseOtherTransaction()
        expect(await pending).toEqual(INVALID_TOKEN)
        expect(database.state.tables.passwordResetTokens).toEqual(
            before.passwordResetTokens,
        )
        expect(database.state.tables.users[0].passwordHash).toBe(
            'previous-password-hash',
        )
        expectNoCompletionEffects()
    })

    it.each<PasswordResetTestFailure>([
        'password-update',
        'empty-password-update',
        'sessions-delete',
        'trustedDevices-delete',
        'audit',
        'commit',
    ])(
        'rolls back token, password and revocations after a %s failure',
        async function (phase) {
            const before = structuredClone(database.state.tables)
            database.state.failAt = phase
            await expect(updatePasswordByTokenService(INPUT)).rejects.toThrow(
                phase === 'empty-password-update'
                    ? 'Password reset user update failed'
                    : 'Synthetic ' + phase + ' failure',
            )
            expect(database.state.tables).toEqual(before)
            expect(database.state.events).toContain('tx-1:rollback')
            expectNoCompletionEffects()
            database.state.failAt = null
            expect(await updatePasswordByTokenService(INPUT)).toEqual({
                success: true,
            })
            expectOnlyOtherUserAuthState()
        },
    )

    it('leaves the token untouched when password hashing fails before the transaction', async function () {
        vi.spyOn(Bun.password, 'hash').mockRejectedValueOnce(
            new Error('Synthetic hash failure'),
        )
        const before = structuredClone(database.state.tables)
        await expect(updatePasswordByTokenService(INPUT)).rejects.toThrow(
            'Synthetic hash failure',
        )
        expect(database.state.tables).toEqual(before)
        expect(database.state.transactionCount).toBe(0)
        expectNoCompletionEffects()
    })

    it('keeps the committed reset and audit when realtime publishing fails', async function () {
        const failure = new Error('Synthetic realtime failure')
        services.publish.mockRejectedValueOnce(failure)
        expect(await updatePasswordByTokenService(INPUT)).toEqual({
            success: true,
        })
        expectOnlyOtherUserAuthState()
        expect(database.state.tables.users[0].passwordHash).toBe('hashed:new')
        expect(services.audit).toHaveBeenCalledTimes(1)
        expect(services.issueGrant).toHaveBeenCalledTimes(1)
        expect(services.logError).toHaveBeenCalledWith(
            'auth.password_reset.realtime_revoke_failed',
            failure,
            { userId: USER_ID },
        )
    })
    it('waits for the committed reset and completed audit before issuing a login recovery grant', async function () {
        const auditStarted = createGate()
        const finishAudit = createGate()
        services.audit.mockImplementationOnce(async function () {
            database.state.events.push('audit-started')
            auditStarted.release()
            await finishAudit.promise
            database.state.events.push('audit-finished')
        })
        const pending = updatePasswordByTokenService(INPUT)
        await auditStarted.promise
        expect(enqueueSecurityChange).not.toHaveBeenCalled()
        expect(database.state.events).not.toContain('tx-1:commit')
        expect(database.state.tables).toEqual(initialTables())
        expect(services.publish).not.toHaveBeenCalled()
        expect(services.issueGrant).not.toHaveBeenCalled()
        finishAudit.release()
        const response = await pending
        expect(response).toEqual({ success: true })
        expect(database.state.events.indexOf('audit-finished')).toBeLessThan(
            database.state.events.indexOf('recovery-grant'),
        )
        expect(services.issueGrant).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(response)).not.toContain(INPUT.token)
        expect(JSON.stringify(response)).not.toContain('hashed:new')
    })

    it('binds the recovery grant to the username read under the final user lock', async function () {
        const hashing = pauseHashing()
        const pending = updatePasswordByTokenService(INPUT)
        await hashing.entered
        database.state.tables.users[0].username = 'renamed-reset-user'
        hashing.resume()
        expect(await pending).toEqual({ success: true })
        expect(services.issueGrant).toHaveBeenCalledWith({
            userId: USER_ID,
            username: 'renamed-reset-user',
            passwordHash: 'hashed:new',
        })
    })

    it('keeps a successful reset when grant output fails and logs no token or credential payload', async function () {
        const failure = new Error(
            'Synthetic recovery output failure: ' + INPUT.token + ' hashed:new',
        )
        services.issueGrant.mockRejectedValueOnce(failure)
        const result = await updatePasswordByTokenService(INPUT)
        expect(result).toEqual({ success: true })
        expect(database.state.tables.users[0].passwordHash).toBe('hashed:new')
        expectOnlyOtherUserAuthState()
        expect(database.state.events).toContain('tx-1:commit')
        expect(services.publish).toHaveBeenCalledTimes(1)
        expect(services.audit).toHaveBeenCalledTimes(1)
        expect(services.issueGrant).toHaveBeenCalledTimes(1)
        expect(services.logWarn).toHaveBeenCalledTimes(1)
        expect(services.logWarn).toHaveBeenCalledWith(
            'auth.password_reset.recovery_unavailable',
            { userId: USER_ID },
        )
        const warning = JSON.stringify(services.logWarn.mock.calls)
        expect(warning).not.toContain(INPUT.token)
        expect(warning).not.toContain('hashed:new')
        expect(warning).not.toContain(failure.message)
        expect(JSON.stringify(result)).not.toContain(INPUT.token)
        expect(JSON.stringify(result)).not.toContain('hashed:new')
    })

    it('captures the contact under the final user lock and enqueues only after the audit and password commit', async function () {
        database.state.onLockRequested = function () {
            database.state.tables.users[0].email = 'locked-contact@example.test'
        }
        const observations: Array<PasswordResetTestTables> = []
        enqueueSecurityChange.mockImplementationOnce(async function () {
            observations.push(structuredClone(database.state.tables))
            database.state.tables.users[0].email = 'later-contact@example.test'
            database.state.events.push('notification')
        })
        expect(await updatePasswordByTokenService(INPUT)).toEqual({
            success: true,
        })
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(enqueueSecurityChange).toHaveBeenCalledWith({
            to: 'locked-contact@example.test',
            change: 'password_changed',
            changedAt: NOW.toISOString(),
            auditEventId: 'tx-1:audit',
        })
        expect(observations).toHaveLength(1)
        expect(observations[0].auditLogs).toHaveLength(1)
        expect(observations[0].users[0].passwordHash).toBe('hashed:new')
        expect(database.state.events.indexOf('tx-1:commit')).toBeLessThan(
            database.state.events.indexOf('notification'),
        )
        expect(database.state.events.indexOf('notification')).toBeLessThan(
            database.state.events.indexOf('audit-publish'),
        )
        expect(database.state.events.indexOf('notification')).toBeLessThan(
            database.state.events.indexOf('realtime'),
        )
    })

    it('preserves committed credentials and all later completion effects when the notification queue is unavailable', async function () {
        const failure = new Error('Synthetic notification failure')
        enqueueSecurityChange.mockRejectedValueOnce(failure)
        expect(await updatePasswordByTokenService(INPUT)).toEqual({
            success: true,
        })
        expect(database.state.tables.users[0].passwordHash).toBe('hashed:new')
        expectOnlyOtherUserAuthState()
        expect(database.state.tables.auditLogs).toHaveLength(1)
        expect(database.state.events).toContain('audit-publish')
        expect(services.publish).toHaveBeenCalledTimes(1)
        expect(services.issueGrant).toHaveBeenCalledTimes(1)
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(services.logError).toHaveBeenCalledWith(
            'auth.security_change_notification.failed',
            failure,
            { auditLogId: 'tx-1:audit' },
        )
    })

    it('attempts the committed notification even when subsequent recovery output fails', async function () {
        services.issueGrant.mockRejectedValueOnce(
            new Error('Synthetic recovery failure'),
        )
        expect(await updatePasswordByTokenService(INPUT)).toEqual({
            success: true,
        })
        expect(enqueueSecurityChange).toHaveBeenCalledTimes(1)
        expect(database.state.tables.auditLogs).toHaveLength(1)
        expectOnlyOtherUserAuthState()
    })
})
