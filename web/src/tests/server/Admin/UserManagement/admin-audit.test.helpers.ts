import { createLazyTestQuery } from '@/tests/shared/lazy-query.test.helpers.ts'
import { vi } from 'bun:test'
import type { AuthMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type {
    AdminTestCondition,
    AdminTestContext,
    AdminTestEvent,
    AdminTestQuery,
    AdminTestRow,
    AdminTestSelection,
    AdminTestTable,
} from './admin-audit.test.types.ts'

export const ADMIN_ACTOR_ID = '00000000-0000-4000-8000-000000000002'
export const ADMIN_TARGET_ID = '00000000-0000-4000-8000-000000000001'

function createTestTable(name: string, columns: string[]): AdminTestTable {
    return Object.fromEntries([
        ['tableName', name],
        ...columns.map((column) => [column, name + '.' + column]),
    ])
}
const adminAuditSchema = {
    users: createTestTable('users', [
        'id',
        'username',
        'email',
        'passwordHash',
        'isActive',
        'isDeleted',
        'isTwoFactorEnabled',
        'accountType',
        'createdAt',
    ]),
    user_profiles: createTestTable('user_profiles', [
        'userId',
        'firstName',
        'lastName',
        'street',
        'houseNumber',
        'postalCode',
        'city',
        'profileImageUpdatedAt',
    ]),
    permissions: createTestTable('permissions', ['id', 'key']),
    staffUserPermissions: createTestTable('staffUserPermissions', [
        'userId',
        'permissionId',
    ]),
    accountPermissions: createTestTable('accountPermissions', [
        'userId',
        'permissionId',
    ]),
    publicUserPermissions: createTestTable('publicUserPermissions', [
        'userId',
        'permissionId',
    ]),
    staffInvitations: createTestTable('staffInvitations', [
        'id',
        'email',
        'username',
        'expiresAt',
        'invitedByUserId',
        'permissionKeys',
        'tokenHash',
    ]),
    staffAccounts: createTestTable('staffAccounts', [
        'userId',
        'invitedByUserId',
    ]),
    defaultUserPermissions: createTestTable('defaultUserPermissions', [
        'permissionId',
    ]),
    permissionPresets: createTestTable('permissionPresets', [
        'id',
        'name',
        'description',
        'createdAt',
        'updatedAt',
    ]),
    permissionPresetPermissions: createTestTable(
        'permissionPresetPermissions',
        ['presetId', 'permissionId'],
    ),
    sessions: createTestTable('sessions', ['id', 'userId']),
    socialAccounts: createTestTable('socialAccounts', [
        'id',
        'userId',
        'provider',
        'subject',
    ]),
    passwordResetTokens: createTestTable('passwordResetTokens', [
        'userId',
        'tokenHash',
        'expiresAt',
    ]),
    trustedDevices: createTestTable('trustedDevices', ['id', 'userId']),
    passkeyChallenges: createTestTable('passkeyChallenges', ['id', 'userId']),
    twoFactorAuth: createTestTable('twoFactorAuth', ['id', 'userId']),
    notifications: createTestTable('notifications', [
        'id',
        'userId',
        'title',
        'message',
        'type',
        'referenceId',
        'isRead',
        'readAt',
        'createdAt',
    ]),
    auditLogs: createTestTable('auditLogs', ['id', 'createdAt']),
    systemSettings: createTestTable('systemSettings', [
        'id',
        'companyName',
        'isMaintenanceModeEnabled',
        'maintenanceStartsAt',
        'logoUpdatedAt',
        'updatedAt',
    ]),
}

function field(value: unknown, context: AdminTestContext): unknown {
    if (typeof value !== 'string') return value
    const separator = value.indexOf('.')
    const row = context[value.slice(0, separator)]
    return row ? row[value.slice(separator + 1)] : value
}
function matches(
    condition: AdminTestCondition | undefined,
    context: AdminTestContext,
): boolean {
    if (!condition) return true
    if (condition.kind === 'and')
        return condition.values.every((item) =>
            matches(item as AdminTestCondition, context),
        )
    if (condition.kind === 'or')
        return condition.values.some((item) =>
            matches(item as AdminTestCondition, context),
        )
    const left = field(condition.values[0], context)
    const right = field(condition.values[1], context)
    if (condition.kind === 'lowerEq')
        return typeof left === 'string' && left.toLowerCase() === right
    if (condition.kind === 'eq') return left === right
    if (condition.kind === 'ne') return left !== right
    if (
        condition.kind === 'gt' &&
        left instanceof Date &&
        right instanceof Date
    )
        return left > right
    if (
        condition.kind === 'lte' &&
        left instanceof Date &&
        right instanceof Date
    )
        return left <= right
    if (condition.kind === 'inArray' && Array.isArray(right))
        return right.includes(left)
    throw new Error('Unsupported test condition')
}
function project(
    context: AdminTestContext,
    selection?: AdminTestSelection,
): AdminTestRow {
    return selection
        ? Object.fromEntries(
              Object.entries(selection).map(([key, value]) => [
                  key,
                  field(value, context),
              ]),
          )
        : Object.assign({}, ...Object.values(context))
}

function createAdminAuditTestDatabase() {
    const state = {
        rows: {} as Record<string, AdminTestRow[]>,
        events: [] as AdminTestEvent[],
        actorUserId: ADMIN_ACTOR_ID as string | null,
        activeTransaction: 0,
        nextTransaction: 0,
        nextId: 0,
        failTable: null as string | null,
        failAuditAction: null as string | null,
        emptyAuditReceipt: false,
        emptyReturningTable: null as string | null,
        failCommitTransaction: null as number | null,
        persistenceError: null as Error | null,
    }
    function connection(
        rows: Record<string, AdminTestRow[]>,
        transaction: number,
    ) {
        function query(
            mode: 'select' | 'insert' | 'update' | 'delete',
            initialTable?: AdminTestTable,
            selection?: AdminTestSelection,
        ): AdminTestQuery {
            let source = initialTable
            let condition: AdminTestCondition | undefined
            let rowLimit: number | undefined
            let values: AdminTestRow[] = []
            let updates: AdminTestRow = {}
            let conflict: { target?: string; set?: AdminTestRow } | undefined
            const joins: Array<{
                table: AdminTestTable
                condition: AdminTestCondition
            }> = []
            let completed: AdminTestRow[] | undefined
            function execute(): AdminTestRow[] {
                if (completed) return completed
                if (!source) throw new Error('Missing test table')
                const name = source.tableName
                if (mode === 'select') {
                    const selectedRows =
                        name === 'accountPermissions'
                            ? [
                                  ...rows.staffUserPermissions,
                                  ...rows.publicUserPermissions,
                              ]
                            : rows[name]
                    let contexts = selectedRows.map((row) => ({ [name]: row }))
                    for (const join of joins) {
                        contexts = contexts.flatMap((context) =>
                            rows[join.table.tableName]
                                .map((row) => ({
                                    ...context,
                                    [join.table.tableName]: row,
                                }))
                                .filter((joinedContext) =>
                                    matches(join.condition, joinedContext),
                                ),
                        )
                    }
                    contexts = contexts.filter((context) =>
                        matches(condition, context),
                    )
                    if (
                        selection &&
                        Object.values(selection).some(
                            (value) => value === 'count',
                        )
                    ) {
                        completed = Object.keys(selection).map((key) => ({
                            [key]: contexts.length,
                        }))
                    } else {
                        completed = (
                            rowLimit === undefined
                                ? contexts
                                : contexts.slice(0, rowLimit)
                        ).map((context) => project(context, selection))
                    }
                    return completed
                }
                if (!transaction)
                    throw new Error(
                        'Unexpected global database mutation: ' + name,
                    )
                state.events.push({
                    transaction,
                    operation: mode,
                    table: name,
                    values: structuredClone(
                        mode === 'insert' ? values : updates,
                    ),
                })
                if (
                    state.failTable === name ||
                    (name === 'auditLogs' &&
                        values.some(
                            (row) => row.action === state.failAuditAction,
                        ))
                ) {
                    throw (
                        state.persistenceError ??
                        new Error('Injected persistence failure: ' + name)
                    )
                }
                let affected: AdminTestRow[]
                if (mode === 'insert') {
                    affected = []
                    for (const value of values) {
                        const target = conflict
                            ? (conflict.target?.split('.').at(-1) ?? 'id')
                            : undefined
                        const existing = target
                            ? rows[name].find(
                                  (row) => row[target] === value[target],
                              )
                            : undefined
                        if (existing && conflict) {
                            if (conflict.set) {
                                Object.assign(existing, conflict.set)
                                affected.push(existing)
                            }
                            continue
                        }
                        const row: AdminTestRow = {
                            id: name + '-' + String(++state.nextId),
                            createdAt: new Date('2026-09-06T12:00:00.000Z'),
                            updatedAt: new Date('2026-09-06T12:00:00.000Z'),
                            isActive: true,
                            isDeleted: false,
                            isTwoFactorEnabled: false,
                            firstName: null,
                            lastName: null,
                            street: null,
                            houseNumber: null,
                            postalCode: null,
                            city: null,
                            profileImageUpdatedAt: null,
                            referenceId: null,
                            readAt: null,
                            isRead: false,
                            ...value,
                        }
                        rows[name].push(row)
                        affected.push(row)
                    }
                } else {
                    affected = rows[name].filter((row) =>
                        matches(condition, { [name]: row }),
                    )
                    if (mode === 'update')
                        affected.forEach((row) => Object.assign(row, updates))
                    else {
                        rows[name] = rows[name].filter(
                            (row) => !affected.includes(row),
                        )
                        if (name === 'users') {
                            for (const child of [
                                'user_profiles',
                                'staffUserPermissions',
                                'passwordResetTokens',
                                'sessions',
                                'trustedDevices',
                                'twoFactorAuth',
                                'passkeyChallenges',
                                'notifications',
                            ]) {
                                rows[child] = rows[child].filter(
                                    (row) =>
                                        !affected.some(
                                            (user) => user.id === row.userId,
                                        ),
                                )
                            }
                        }
                    }
                }
                completed =
                    (name === 'auditLogs' && state.emptyAuditReceipt) ||
                    state.emptyReturningTable === name
                        ? []
                        : affected.map((row) =>
                              project({ [name]: row }, selection),
                          )
                return completed
            }
            const chain: AdminTestQuery = {
                from(value) {
                    source = value
                    return chain
                },
                where(value) {
                    condition = value
                    return chain
                },
                innerJoin(joinedTable, joinCondition) {
                    joins.push({ table: joinedTable, condition: joinCondition })
                    return chain
                },
                limit(value) {
                    rowLimit = value
                    return chain
                },
                orderBy() {
                    return chain
                },
                async for(lockMode) {
                    const result = execute()
                    state.events.push({
                        transaction,
                        operation: 'lock:' + lockMode,
                        table: source?.tableName,
                        ids: result.map((row) => row.id),
                    })
                    return result
                },
                values(value) {
                    values = Array.isArray(value) ? value : [value]
                    return chain
                },
                set(value) {
                    updates = value
                    return chain
                },
                onConflictDoNothing(value) {
                    conflict = value ?? {}
                    return chain
                },
                onConflictDoUpdate(value) {
                    conflict = value
                    return chain
                },
                async returning(value) {
                    selection = value
                    return execute()
                },

                ...createLazyTestQuery(() => Promise.resolve().then(execute)),
            }
            return chain
        }
        return {
            async execute() {
                state.events.push({ transaction, operation: 'lock:identity' })
            },
            select: (selection?: AdminTestSelection) =>
                query('select', undefined, selection),
            insert: (table: AdminTestTable) => query('insert', table),
            update: (table: AdminTestTable) => query('update', table),
            delete: (table: AdminTestTable) => query('delete', table),
        }
    }
    const db = {
        select: (selection?: AdminTestSelection) =>
            connection(state.rows, 0).select(selection),
        insert: (table: AdminTestTable) =>
            connection(state.rows, 0).insert(table),
        async transaction<Result>(
            operation: (
                transaction: ReturnType<typeof connection>,
            ) => Promise<Result>,
        ) {
            const transaction = ++state.nextTransaction
            const rows = structuredClone(state.rows)
            state.activeTransaction = transaction
            state.events.push({ transaction, operation: 'begin' })
            try {
                const result = await operation(connection(rows, transaction))
                if (state.failCommitTransaction === transaction)
                    throw new Error('Injected transaction commit failure')
                state.rows = rows
                state.events.push({ transaction, operation: 'commit' })
                return result
            } catch (error) {
                state.events.push({ transaction, operation: 'rollback' })
                throw error
            } finally {
                state.activeTransaction = 0
            }
        },
    }
    function reset() {
        state.rows = Object.fromEntries(
            Object.keys(adminAuditSchema).map((name) => [name, []]),
        )
        state.rows.users = [
            {
                id: ADMIN_TARGET_ID,
                username: 'target',
                email: 'target@example.test',
                passwordHash: 'original-target-password-hash',
                isActive: true,
                isDeleted: false,
                accountType: 'staff',
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
                id: ADMIN_ACTOR_ID,
                username: 'actor',
                email: 'actor@example.test',
                passwordHash: 'original-actor-password-hash',
                isActive: true,
                isDeleted: false,
                accountType: 'staff',
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ]
        state.rows.user_profiles = state.rows.users.map((user) => ({
            userId: user.id,
            firstName: 'Before',
            lastName: null,
            street: null,
            houseNumber: null,
            postalCode: null,
            city: null,
            profileImageUpdatedAt: null,
        }))
        state.rows.permissions = Object.values(PERMISSIONS).map((key) => ({
            id: 'permission:' + key,
            key,
        }))
        state.rows.staffUserPermissions = [
            {
                userId: ADMIN_ACTOR_ID,
                permissionId: 'permission:' + PERMISSIONS.ADMIN_SUPER_USER,
            },
            {
                userId: ADMIN_ACTOR_ID,
                permissionId: 'permission:' + PERMISSIONS.ADMIN_USER_MANAGEMENT,
            },
            {
                userId: ADMIN_TARGET_ID,
                permissionId: 'permission:' + PERMISSIONS.USER_DASHBOARD,
            },
        ]
        state.rows.defaultUserPermissions = [
            { permissionId: 'permission:' + PERMISSIONS.USER_DASHBOARD },
        ]
        state.rows.sessions = [
            { id: 'actor-session', userId: ADMIN_ACTOR_ID },
            { id: 'target-session', userId: ADMIN_TARGET_ID },
        ]
        state.rows.socialAccounts = [
            {
                id: 'target-social-account',
                userId: ADMIN_TARGET_ID,
                provider: 'google',
                subject: 'target-provider-subject',
            },
            {
                id: 'actor-social-account',
                userId: ADMIN_ACTOR_ID,
                provider: 'github',
                subject: 'actor-provider-subject',
            },
        ]
        state.rows.twoFactorAuth = [
            {
                id: '00000000-0000-4000-8000-000000000003',
                userId: ADMIN_TARGET_ID,
                verified: true,
            },
        ]
        state.rows.trustedDevices = [
            { id: 'target-device', userId: ADMIN_TARGET_ID },
        ]
        state.rows.passwordResetTokens = [
            {
                userId: ADMIN_TARGET_ID,
                tokenHash: 'older-token-hash',
                expiresAt: new Date('2030-01-01T00:00:00Z'),
            },
        ]
        state.events = []
        state.actorUserId = ADMIN_ACTOR_ID
        state.activeTransaction = state.nextTransaction = state.nextId = 0
        state.failTable = state.failAuditAction = null
        state.emptyAuditReceipt = false
        state.emptyReturningTable =
            state.failCommitTransaction =
            state.persistenceError =
                null
    }
    reset()
    return { state, db, reset }
}

export const adminAuditDb = createAdminAuditTestDatabase()
export const adminAuditExternal = {
    getCookie: vi.fn(() => 'revoked-synthetic-cookie'),
    publishAudit: vi.fn(async function () {}),
    publishUser: vi.fn(async function () {}),
    publishRevocation: vi.fn(async function () {}),
    publishPermissions: vi.fn(async function () {}),
    publishNotification: vi.fn(async function () {}),
    enqueueReset: vi.fn(async function (_input: AuthMailInput) {}),
    enqueueInvitation: vi.fn(async function (_input: AuthMailInput) {}),
    logError: vi.fn(),
}
export function installAdminAuditTestMocks() {
    vi.mock('@/db', () => ({ db: adminAuditDb.db }))
    vi.mock('@/db/schema.ts', () => adminAuditSchema)
    vi.mock('@/db/Schema/accounts.ts', () => ({
        staffInvitations: adminAuditSchema.staffInvitations,
    }))
    vi.mock('@/db/Schema/users.ts', () => ({
        users: adminAuditSchema.users,
        user_profiles: adminAuditSchema.user_profiles,
    }))
    vi.mock('@/db/Schema/socialAuth.ts', () => ({
        socialAccounts: adminAuditSchema.socialAccounts,
    }))
    vi.mock('drizzle-orm', () => ({
        and: (...values: unknown[]) => ({ kind: 'and', values }),
        or: (...values: unknown[]) => ({ kind: 'or', values }),
        eq: (...values: unknown[]) => ({ kind: 'eq', values }),
        gt: (...values: unknown[]) => ({ kind: 'gt', values }),
        lte: (...values: unknown[]) => ({ kind: 'lte', values }),
        ne: (...values: unknown[]) => ({ kind: 'ne', values }),
        inArray: (...values: unknown[]) => ({ kind: 'inArray', values }),
        asc: (value: unknown) => value,
        count: () => 'count',
        sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (strings.join('') === 'lower() = ')
                return { kind: 'lowerEq', values }
            if (strings.join('') === 'select pg_advisory_xact_lock(7421906)')
                return { kind: 'identityLock', values }
            throw new Error('Unsupported test SQL')
        },
    }))
    vi.mock('@tanstack/react-start/server', () => ({
        deleteCookie: vi.fn(),
        getCookie: adminAuditExternal.getCookie,
        getRequestHeader: () =>
            'https://example.test/admin/users?secret=excluded',
    }))
    vi.mock('@/server/Auth/currentSession.ts', () => ({
        getCurrentSessionUserId: async () => adminAuditDb.state.actorUserId,
    }))
    vi.mock('@/server/Queues/mail.queue.ts', () => ({
        enqueuePasswordResetMail: adminAuditExternal.enqueueReset,
        enqueuePasswordSetupMail: adminAuditExternal.enqueueInvitation,
    }))
    vi.mock('@/server/Realtime/publish.service.ts', () => ({
        publishAuditLogCreatedService: adminAuditExternal.publishAudit,
        publishUserUpdatedService: adminAuditExternal.publishUser,
        publishUserAccessRevokedService: adminAuditExternal.publishRevocation,
        publishPermissionManagementUpdatedService:
            adminAuditExternal.publishPermissions,
        publishNotificationCreatedService:
            adminAuditExternal.publishNotification,
    }))
    vi.mock('@/server/Logging/logger.ts', () => ({
        logError: adminAuditExternal.logError,
    }))
}
