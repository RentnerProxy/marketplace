import { LazyTestQuery } from '@/tests/shared/lazy-query.test.helpers.ts'
import { vi } from 'bun:test'
import type { WriteAuditLogInput } from '@/lib/AuditLogs/Types/audit.types.ts'
import type {
    AuthAuditTestContext,
    AuthAuditTestPredicate,
    AuthAuditTestRow,
    AuthAuditTestRows,
    AuthAuditTestState,
    AuthAuditTestTable,
} from './audit-transaction.test.types.ts'

const tables: Array<AuthAuditTestTable> = [
    'users',
    'sessions',
    'passwordResetTokens',
    'auditLogs',
    'systemSettings',
    'user_profiles',
    'staffUserPermissions',
    'staffAccounts',
    'defaultUserPermissions',
    'permissions',
]
export const authAuditSchema = {
    users: {
        id: 'id',
        username: 'username',
        email: 'email',
        isActive: 'isActive',
        isDeleted: 'isDeleted',
    },
    sessions: { id: 'id', userId: 'userId' },
    passwordResetTokens: { id: 'id', userId: 'userId', tokenHash: 'tokenHash' },
    auditLogs: { id: 'id', createdAt: 'createdAt' },
    systemSettings: { id: 'id' },
    user_profiles: { userId: 'userId' },
    staffAccounts: { userId: 'userId' },
    defaultUserPermissions: { permissionId: 'permissionId' },
    staffUserPermissions: { userId: 'userId', permissionId: 'permissionId' },
    permissions: { id: 'id' },
}
export const authAuditOrm = {
    eq:
        (column: string, value: unknown): AuthAuditTestPredicate =>
        (row) =>
            row[column] === value,
    and:
        (
            ...conditions: Array<AuthAuditTestPredicate>
        ): AuthAuditTestPredicate =>
        (row) =>
            conditions.every((condition) => condition(row)),
    or:
        (
            ...conditions: Array<AuthAuditTestPredicate>
        ): AuthAuditTestPredicate =>
        (row) =>
            conditions.some((condition) => condition(row)),
    sql: (...parts: Array<unknown>) => parts,
}
function emptyRows(): AuthAuditTestRows {
    return {
        users: [],
        sessions: [],
        passwordResetTokens: [],
        auditLogs: [],
        systemSettings: [],
        user_profiles: [],
        staffUserPermissions: [],
        staffAccounts: [],
        defaultUserPermissions: [],
        permissions: [],
    }
}
export const authAuditState: AuthAuditTestState = {
    rows: emptyRows(),
    events: [],
    nextTransaction: 0,
    failAuditAt: null,
    auditAttempts: 0,
    failCommitAt: null,
}
function tableName(table: unknown): AuthAuditTestTable {
    for (const name of tables) if (authAuditSchema[name] === table) return name
    throw new Error('Unexpected isolated audit table')
}
function project(
    rows: Array<AuthAuditTestRow>,
    selection?: Record<string, string>,
) {
    return rows.map((row) =>
        selection
            ? Object.fromEntries(
                  Object.entries(selection).map(([key, column]) => [
                      key,
                      row[column],
                  ]),
              )
            : { ...row },
    )
}
class AuthAuditReadQuery extends LazyTestQuery<Array<AuthAuditTestRow>> {
    constructor(
        private table: AuthAuditTestTable,
        private predicate: AuthAuditTestPredicate,
        private selection?: Record<string, string>,
        private context?: AuthAuditTestContext,
        private maximum = Number.MAX_SAFE_INTEGER,
    ) {
        super(() => Promise.resolve().then(() => this.rows()))
    }
    private rows() {
        authAuditState.events.push('read:' + this.table)
        return project(
            (this.context?.rows ?? authAuditState.rows)[this.table]
                .filter(this.predicate)
                .slice(0, this.maximum),
            this.selection,
        )
    }
    limit(maximum: number) {
        this.maximum = maximum
        return this
    }
    async for(mode: string) {
        if (!this.context || mode !== 'update' || this.table !== 'users')
            throw new Error('Expected user-first audit lock')
        this.context.userLocked = true
        authAuditState.events.push('lock:users')
        return this.rows()
    }
}
export function createAuthAuditTestApi(context?: AuthAuditTestContext) {
    function requireMutation() {
        if (!context?.userLocked)
            throw new Error('Mutation without user/bootstrap lock')
        return context.rows
    }
    return {
        select(selection?: Record<string, string>) {
            return {
                from(table: unknown) {
                    const name = tableName(table)
                    return {
                        where(predicate: AuthAuditTestPredicate) {
                            return new AuthAuditReadQuery(
                                name,
                                predicate,
                                selection,
                                context,
                            )
                        },
                        limit(maximum: number) {
                            return new AuthAuditReadQuery(
                                name,
                                () => true,
                                selection,
                                context,
                                maximum,
                            )
                        },
                    }
                },
            }
        },
        delete(table: unknown) {
            const name = tableName(table)
            return {
                where(predicate: AuthAuditTestPredicate) {
                    const rows = requireMutation()
                    const removed = rows[name].filter(predicate)
                    rows[name] = rows[name].filter((row) => !predicate(row))
                    authAuditState.events.push('delete:' + name)
                    return {
                        async returning(selection?: Record<string, string>) {
                            return project(removed, selection)
                        },
                    }
                },
            }
        },
        insert(table: unknown) {
            const name = tableName(table)
            return {
                values(input: AuthAuditTestRow | Array<AuthAuditTestRow>) {
                    const rows = requireMutation()
                    const values = Array.isArray(input) ? input : [input]
                    const inserted = values.map((value, index) =>
                        Object.assign(
                            {
                                id:
                                    'new-' +
                                    name +
                                    '-' +
                                    String(rows[name].length + index + 1),
                            },
                            value,
                        ),
                    )
                    rows[name].push(...inserted)
                    authAuditState.events.push('insert:' + name)
                    const result = {
                        onConflictDoNothing() {
                            return result
                        },
                        async returning(selection?: Record<string, string>) {
                            return project(inserted, selection)
                        },
                    }
                    return result
                },
            }
        },
        async execute() {
            if (!context)
                throw new Error('Bootstrap lock requires a transaction')
            context.userLocked = true
            authAuditState.events.push('lock:bootstrap')
        },
        recordAudit(input: WriteAuditLogInput) {
            if (!context) throw new Error('Audit outside transaction')
            if (input.actorUserId && !context.userLocked)
                throw new Error('Actor is not locked')
            authAuditState.events.push('audit:tx')
            if (++authAuditState.auditAttempts === authAuditState.failAuditAt)
                throw new Error('Synthetic audit failure')
            const receipt = {
                id: 'audit-' + String(context.id),
                createdAt: new Date('2026-09-06T12:00:00Z'),
            }
            context.rows.auditLogs.push({ ...input, ...receipt })
            return receipt
        },
    }
}

export const authAuditDb = {
    ...createAuthAuditTestApi(),
    transaction: vi.fn(async function <Result>(
        operation: (
            transaction: ReturnType<typeof createAuthAuditTestApi>,
        ) => Promise<Result>,
    ): Promise<Result> {
        const context: AuthAuditTestContext = {
            id: ++authAuditState.nextTransaction,
            rows: structuredClone(authAuditState.rows),
            userLocked: false,
        }
        authAuditState.events.push('tx:begin')
        try {
            const result = await operation(createAuthAuditTestApi(context))
            if (authAuditState.failCommitAt === context.id)
                throw new Error('Synthetic commit failure')
            authAuditState.rows = context.rows
            authAuditState.events.push('tx:commit')
            return result
        } catch (error) {
            authAuditState.events.push('tx:rollback')
            throw error
        }
    }),
}
export const authAuditMocks = {
    prepareAuditContextService(actorUserId: string | null) {
        authAuditState.events.push('context')
        return { actorUserId, route: '/synthetic-request', method: 'POST' }
    },
    writeAuditLogInTransactionService: vi.fn(async function (
        transaction: ReturnType<typeof createAuthAuditTestApi>,
        input: WriteAuditLogInput,
    ) {
        return transaction.recordAudit(input)
    }),
    publishCommittedAuditLogService: vi.fn(async function (_receipt: {
        id: string
        createdAt: Date
    }) {
        authAuditState.events.push('audit:publish')
    }),
}
export function resetAuthAuditTestState() {
    authAuditState.rows = emptyRows()
    authAuditState.events = []
    authAuditState.nextTransaction = 0
    authAuditState.failAuditAt = null
    authAuditState.auditAttempts = 0
    authAuditState.failCommitAt = null
}
