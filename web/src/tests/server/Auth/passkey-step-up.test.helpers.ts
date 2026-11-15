import { LazyTestQuery } from '@/tests/shared/lazy-query.test.helpers.ts'
import { vi } from 'bun:test'
import type {
    PasskeyTestContext,
    PasskeyTestOperation,
    PasskeyTestPredicate,
    PasskeyTestRow,
    PasskeyTestRows,
    PasskeyTestState,
    PasskeyTestTable,
} from './passkey-step-up.test.types.ts'

export const PASSKEY_TEST_SESSION_HASH = 'a'.repeat(64)
export const passkeyTestUser = {
    id: 'user-1',
    username: 'kevin',
    email: 'kevin@example.test',
    passwordHash: 'synthetic-password-hash',
    isTwoFactorEnabled: false,
    isActive: true,
    isDeleted: false,
}
export const passkeyTestSession = {
    id: 'user-1',
    username: 'kevin',
    email: 'kevin@example.test',
    sessionHash: PASSKEY_TEST_SESSION_HASH,
    isActive: true,
    isDeleted: false,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
}
export const passkeyTestOtherUserSession = {
    id: 'e'.repeat(64),
    userId: 'other-user',
    expiresAt: passkeyTestSession.expiresAt,
}
export const passkeyTestSchema = {
    users: {
        id: 'id',
        username: 'username',
        email: 'email',
        passwordHash: 'passwordHash',
        isTwoFactorEnabled: 'isTwoFactorEnabled',
        isActive: 'isActive',
        isDeleted: 'isDeleted',
    },
    sessions: { id: 'id', userId: 'userId', expiresAt: 'expiresAt' },
    twoFactorAuth: { id: 'id', userId: 'userId', verified: 'verified' },
    passkeyChallenges: {
        id: 'id',
        userId: 'userId',
        type: 'type',
        identifier: 'identifier',
        expiresAt: 'expiresAt',
    },
    passkeyCredentials: {
        credentialId: 'credentialId',
        id: 'id',
        userId: 'userId',
    },
}
export const passkeyTestOrm = {
    and:
        (...conditions: Array<PasskeyTestPredicate>) =>
        (row: PasskeyTestRow) =>
            conditions.every(function (condition) {
                return condition(row)
            }),
    eq: (column: string, value: unknown) => (row: PasskeyTestRow) =>
        row[column] === value,
    gt: (column: string, value: Date) => (row: PasskeyTestRow) =>
        row[column] instanceof Date && row[column] > value,
    lt: (column: string, value: Date) => (row: PasskeyTestRow) =>
        row[column] instanceof Date && row[column] < value,
    desc: (column: string) => column,
}
function emptyRows(): PasskeyTestRows {
    return {
        users: [],
        sessions: [],
        factors: [],
        challenges: [],
        credentials: [],
        auditLogs: [],
    }
}
export const passkeyTestState: PasskeyTestState = {
    rows: emptyRows(),
    insertValues: [],
    events: [],
    beforeUserLock: null,
    failInsertTable: null,
    failDeleteTable: null,
}
let userLock: Promise<void> = Promise.resolve()
function tableName(table: unknown): PasskeyTestTable {
    if (table === passkeyTestSchema.users) return 'users'
    if (table === passkeyTestSchema.sessions) return 'sessions'
    if (table === passkeyTestSchema.twoFactorAuth) return 'factors'
    if (table === passkeyTestSchema.passkeyChallenges) return 'challenges'
    if (table === passkeyTestSchema.passkeyCredentials) return 'credentials'
    throw new Error('Unexpected table in isolated Passkey adapter')
}
function rowsFor(table: PasskeyTestTable, context?: PasskeyTestContext) {
    return (context?.rows ?? passkeyTestState.rows)[table]
}
async function acquireLock(
    table: PasskeyTestTable,
    context?: PasskeyTestContext,
) {
    if (!context) throw new Error('Policy locks require a transaction')
    if (table === 'users' && !context.rows) {
        const before = passkeyTestState.beforeUserLock
        passkeyTestState.beforeUserLock = null
        before?.()
        const previous = userLock
        userLock = new Promise<void>(function (resolve) {
            context.release = resolve
        })
        await previous
        context.rows = structuredClone(passkeyTestState.rows)
    }
    if (!context.rows) throw new Error('User must be locked before child rows')
    passkeyTestState.events.push('lock:' + table)
}
class PasskeyTestQuery extends LazyTestQuery<Array<PasskeyTestRow>> {
    constructor(
        private table: PasskeyTestTable,
        private predicate: PasskeyTestPredicate,
        private context?: PasskeyTestContext,
        private maximum?: number,
    ) {
        super(() => Promise.resolve().then(() => this.rows()))
    }
    private rows() {
        const rows = rowsFor(this.table, this.context).filter(this.predicate)
        return this.maximum === undefined ? rows : rows.slice(0, this.maximum)
    }
    limit(count: number) {
        this.maximum = count
        return this
    }
    async for(mode: string) {
        if (mode !== 'update') throw new Error('Expected update row lock')
        await acquireLock(this.table, this.context)
        return this.rows()
    }
    async orderBy(_column: string) {
        return this.rows()
    }
}
export function createPasskeyTestApi(context?: PasskeyTestContext) {
    function requireMutationLock() {
        if (context && !context.rows)
            throw new Error('Passkey mutation before proof locks')
    }
    return {
        recordAudit(input: Record<string, unknown>) {
            requireMutationLock()
            if (!context?.rows) throw new Error('Audit requires a transaction')
            const receipt = {
                id: 'audit-' + String(context.rows.auditLogs.length + 1),
                createdAt: new Date(),
            }
            context.rows.auditLogs.push({ ...input, ...receipt })
            passkeyTestState.events.push('audit:tx')
            return receipt
        },
        select: vi.fn(function (..._selection: Array<unknown>) {
            return {
                from: function (table: unknown) {
                    return {
                        where: function (predicate: PasskeyTestPredicate) {
                            return new PasskeyTestQuery(
                                tableName(table),
                                predicate,
                                context,
                            )
                        },
                    }
                },
            }
        }),
        insert: vi.fn(function (table: unknown) {
            return {
                values: function (values: PasskeyTestRow) {
                    requireMutationLock()
                    const name = tableName(table)
                    if (passkeyTestState.failInsertTable === name)
                        throw new Error('Synthetic Passkey insert failure')
                    const rows = rowsFor(name, context)
                    const prefix =
                        name === 'challenges' ? 'challenge' : 'passkey'
                    const row = {
                        ...values,
                        id: prefix + '-' + String(rows.length + 1),
                    }
                    rows.push(row)
                    passkeyTestState.insertValues.push(values)
                    passkeyTestState.events.push(
                        'insert:' + name + (context ? ':tx' : ':global'),
                    )
                    return {
                        returning: async function () {
                            return [row]
                        },
                    }
                },
            }
        }),
        delete: vi.fn(function (table: unknown) {
            return {
                where: function (predicate: PasskeyTestPredicate) {
                    requireMutationLock()
                    const name = tableName(table)
                    if (passkeyTestState.failDeleteTable === name)
                        throw new Error('Synthetic Passkey delete failure')
                    const rows = rowsFor(name, context)
                    const deleted = rows.filter(predicate)
                    for (let index = rows.length - 1; index >= 0; index--)
                        if (predicate(rows[index])) rows.splice(index, 1)
                    passkeyTestState.events.push(
                        'delete:' + name + (context ? ':tx' : ':global'),
                    )
                    return {
                        returning: async function () {
                            if (name === 'sessions')
                                throw new Error(
                                    'Session revocation must not return session IDs',
                                )
                            return deleted
                        },
                    }
                },
            }
        }),
    }
}
export const passkeyTestDb = {
    ...createPasskeyTestApi(),
    transaction: vi.fn(async function <Result>(
        operation: PasskeyTestOperation<Result>,
    ): Promise<Result> {
        const context: PasskeyTestContext = { rows: null, release: null }
        passkeyTestState.events.push('transaction:start')
        try {
            const result = await operation(createPasskeyTestApi(context))
            if (context.rows) passkeyTestState.rows = context.rows
            passkeyTestState.events.push('transaction:commit')
            return result
        } catch (error) {
            passkeyTestState.events.push('transaction:rollback')
            throw error
        } finally {
            context.release?.()
        }
    }),
}
export function resetPasskeyTestState() {
    passkeyTestState.rows = emptyRows()
    passkeyTestState.rows.users = [{ ...passkeyTestUser }]
    passkeyTestState.rows.sessions = [
        {
            id: PASSKEY_TEST_SESSION_HASH,
            userId: passkeyTestUser.id,
            expiresAt: passkeyTestSession.expiresAt,
        },
        {
            id: 'd'.repeat(64),
            userId: passkeyTestUser.id,
            expiresAt: passkeyTestSession.expiresAt,
        },
        { ...passkeyTestOtherUserSession },
    ]
    passkeyTestState.insertValues = []
    passkeyTestState.events = []
    passkeyTestState.beforeUserLock = null
    passkeyTestState.failInsertTable = null
    passkeyTestState.failDeleteTable = null
    userLock = Promise.resolve()
}
