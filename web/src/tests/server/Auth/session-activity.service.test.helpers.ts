import { vi } from 'bun:test'
import type {
    ActivityTestColumn,
    ActivityTestPredicate,
    ActivityTestRow,
    ActivityTestSql,
    ActivityTestTable,
    ActivityTestTables,
    ActivityTestTransaction,
} from './session-activity.service.test.types.ts'
import type { RateLimitOptions } from '@/server/RateLimit/Types/rate-limit.types.ts'

export const STARTED_AT = Date.parse('2026-09-06T03:00:00.000Z')
function activityColumn(
    table: ActivityTestTable,
    field: string,
): ActivityTestColumn {
    return { table, field }
}
export const schema = {
    users: {
        id: activityColumn('users', 'id'),
        isActive: activityColumn('users', 'isActive'),
        isDeleted: activityColumn('users', 'isDeleted'),
    },
    sessions: {
        id: activityColumn('sessions', 'id'),
        userId: activityColumn('sessions', 'userId'),
        expiresAt: activityColumn('sessions', 'expiresAt'),
    },
}
export const state = {
    nowMs: STARTED_AT,
    databaseNowMs: STARTED_AT,
    cookie: undefined as string | undefined,
    rows: { users: [], sessions: [] } as ActivityTestTables,
    events: [] as Array<string>,
    userConditions: [] as Array<ActivityTestPredicate>,
    sessionConditions: [] as Array<ActivityTestPredicate>,
    updateConditions: [] as Array<ActivityTestPredicate>,
    writes: 0,
    rateFailure: null as string | null,
    beforeUserLock: null as (() => Promise<void>) | null,
    afterUserLock: null as (() => Promise<void>) | null,
    afterSessionLock: null as (() => Promise<void>) | null,
    beforeUpdate: null as (() => Promise<void>) | null,
    afterUpdate: null as (() => Promise<void>) | null,
    beforeCommit: null as (() => Promise<void>) | null,
    beforeSessionRateLimit: null as (() => Promise<void>) | null,
}
let lockTail = Promise.resolve()
export function resetActivityLock() {
    lockTail = Promise.resolve()
}
async function acquireUserLock() {
    const previous = lockTail
    let release: (() => void) | undefined
    lockTail = new Promise<void>((resolve) => {
        release = resolve
    })
    await previous
    if (!release) throw new Error('Missing mock lock release')
    return release
}
function getTableName(table: unknown): ActivityTestTable {
    if (table === schema.users) return 'users'
    if (table === schema.sessions) return 'sessions'
    throw new Error('Unexpected activity table')
}
function timestamp(value: unknown): number {
    return value instanceof Date
        ? value.getTime()
        : typeof value === 'string'
          ? Date.parse(value)
          : Number.NaN
}
function matches(
    predicate: ActivityTestPredicate,
    row: ActivityTestRow,
    table: ActivityTestTable,
): boolean {
    if (predicate.kind === 'and') {
        return predicate.conditions.every((item) => matches(item, row, table))
    }
    if (predicate.kind === 'clock') {
        throw new Error('Bare clock cannot be a predicate')
    }
    if (predicate.kind === 'absolute-live') {
        return timestamp(predicate.value) > state.databaseNowMs
    }
    if (predicate.column.table !== table) return false
    const left = row[predicate.column.field]
    if (predicate.kind === 'eq') {
        return left instanceof Date && predicate.value instanceof Date
            ? left.getTime() === predicate.value.getTime()
            : left === predicate.value
    }
    const right = predicate.value
    if (
        typeof right !== 'object' ||
        right === null ||
        !('kind' in right) ||
        right.kind !== 'clock'
    ) {
        throw new Error('Update must compare expiry with the database clock')
    }
    return timestamp(left) > state.databaseNowMs
}
function getRows(transaction?: ActivityTestTransaction) {
    if (transaction && !transaction.rows) {
        throw new Error('Read before mocked user lock')
    }
    return transaction?.rows ?? state.rows
}
function createSelect(transaction?: ActivityTestTransaction) {
    let table: ActivityTestTable = 'sessions'
    let predicate: ActivityTestPredicate | undefined
    const chain = {
        from(selectedTable: unknown) {
            table = getTableName(selectedTable)
            return chain
        },
        where(condition: ActivityTestPredicate) {
            predicate = condition
            return chain
        },
        limit(count: number) {
            let lockRequested = false
            const pending = Promise.resolve().then(() => {
                if (lockRequested) return []
                if (transaction)
                    throw new Error('Transactional read requires lock')
                if (!predicate) throw new Error('Unbounded session lookup')
                state.events.push('identity-read')
                return structuredClone(
                    state.rows[table]
                        .filter((row) => matches(predicate!, row, table))
                        .slice(0, count),
                )
            })
            return Object.assign(pending, {
                async for(mode: string) {
                    lockRequested = true
                    if (!transaction || mode !== 'update' || !predicate) {
                        throw new Error('Invalid activity lock')
                    }
                    if (table === 'users') {
                        await state.beforeUserLock?.()
                        transaction.release = await acquireUserLock()
                        transaction.userLocked = true
                        transaction.rows = structuredClone(state.rows)
                        state.userConditions.push(predicate)
                        state.events.push('user-lock')
                        await state.afterUserLock?.()
                    } else {
                        if (!transaction.userLocked)
                            throw new Error('Session locked before user')
                        transaction.sessionLocked = true
                        state.sessionConditions.push(predicate)
                        state.events.push('session-lock')
                        await state.afterSessionLock?.()
                    }
                    const selectedRows = getRows(transaction)[table]
                    return structuredClone(
                        selectedRows
                            .filter((row) => matches(predicate!, row, table))
                            .slice(0, count),
                    )
                },
            })
        },
    }
    return chain
}
function createTransaction(transaction: ActivityTestTransaction) {
    return {
        select: () => createSelect(transaction),
        update(table: unknown) {
            if (
                getTableName(table) !== 'sessions' ||
                !transaction.userLocked ||
                !transaction.sessionLocked
            ) {
                throw new Error('Update before ordered locks')
            }
            return {
                set(values: { expiresAt: Date }) {
                    return {
                        where(predicate: ActivityTestPredicate) {
                            state.updateConditions.push(predicate)
                            return {
                                async returning() {
                                    await state.beforeUpdate?.()
                                    const affected = getRows(
                                        transaction,
                                    ).sessions.filter((row) =>
                                        matches(predicate, row, 'sessions'),
                                    )
                                    for (const row of affected) {
                                        row.expiresAt = new Date(
                                            values.expiresAt,
                                        )
                                        state.writes += 1
                                    }
                                    const result = affected.map((row) => ({
                                        expiresAt: row.expiresAt,
                                    }))
                                    state.events.push('update')
                                    await state.afterUpdate?.()
                                    return structuredClone(result)
                                },
                            }
                        },
                    }
                },
            }
        },
    }
}
export const database = {
    select: vi.fn(() => createSelect()),
    transaction: vi.fn(
        async (
            callback: (
                transaction: ReturnType<typeof createTransaction>,
            ) => Promise<unknown>,
        ) => {
            const transaction: ActivityTestTransaction = {
                rows: null,
                userLocked: false,
                sessionLocked: false,
                release: null,
            }
            state.events.push('begin')
            try {
                const result = await callback(createTransaction(transaction))
                await state.beforeCommit?.()
                if (transaction.rows) state.rows = transaction.rows
                state.events.push('commit')
                return result
            } catch (error) {
                state.events.push('rollback')
                throw error
            } finally {
                transaction.release?.()
            }
        },
    ),
}
export const services = {
    getCookie: vi.fn((_name: string) => state.cookie),
    setCookie: vi.fn(),
    deleteCookie: vi.fn(),
    enforceRateLimit: vi.fn(async (input: RateLimitOptions) => {
        state.events.push(input.scope)
        if (input.scope === state.rateFailure)
            throw new Error('Synthetic rate limit')
        if (input.scope === 'session-activity-session')
            await state.beforeSessionRateLimit?.()
    }),
}
vi.mock('@tanstack/react-start/server', () => services)
vi.mock('@/db', () => ({ db: database }))
vi.mock('@/db/schema.ts', () => schema)
vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
    enforceRateLimit: services.enforceRateLimit,
}))
vi.mock('drizzle-orm', () => ({
    eq: (
        column: ActivityTestColumn,
        value: unknown,
    ): ActivityTestPredicate => ({ kind: 'eq', column, value }),
    gt: (
        column: ActivityTestColumn,
        value: unknown,
    ): ActivityTestPredicate => ({ kind: 'gt', column, value }),
    and: (
        ...conditions: Array<ActivityTestPredicate>
    ): ActivityTestPredicate => ({ kind: 'and', conditions }),
    sql: (
        parts: TemplateStringsArray,
        ...values: Array<unknown>
    ): ActivityTestSql => {
        const statement = parts.join('?')
        if (statement === 'clock_timestamp()' && values.length === 0)
            return { kind: 'clock' }
        if (
            statement === '?::timestamptz > clock_timestamp()' &&
            values.length === 1
        ) {
            return { kind: 'absolute-live', value: values[0] }
        }
        throw new Error('Unexpected SQL in mocked activity guard')
    },
}))
