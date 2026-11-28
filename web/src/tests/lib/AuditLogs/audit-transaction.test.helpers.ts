import { createLazyTestQuery } from '@/tests/shared/lazy-query.test.helpers.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import { vi } from 'bun:test'
import {
    auditPredicateEquality,
    auditPredicateMatches,
    compareAuditModelRows,
    requireAuditActorLock,
} from './audit-retention.test.helpers.ts'
import type {
    AuditModelAuditRow,
    AuditModelFields,
    AuditModelOrder,
    AuditModelPredicate,
    AuditModelRow,
    AuditModelState,
} from './audit-transaction.test.types.ts'

export const AUDIT_TEST_ACTOR = '11111111-1111-4111-8111-111111111111'

function table(name: string, fields: Array<string>) {
    return Object.fromEntries(
        ['id', ...fields].map((field) => [field, name + '.' + field]),
    )
}

const auditTestSchema = {
    users: table('users', []),
    auditLogs: table('auditLogs', ['createdAt', 'actorUserId', 'action']),
    user_settings: table('user_settings', [
        'userId',
        'themeMode',
        'fontFamily',
        'fontSize',
        'primaryColor',
        'customBackgroundDarkness',
        'customBackgroundUpdatedAt',
    ]),
    user_profiles: table('user_profiles', [
        'userId',
        'bio',
        'profileImageUpdatedAt',
    ]),
    systemSettings: table('systemSettings', [
        'companyName',
        'logoUpdatedAt',
        'isMaintenanceModeEnabled',
        'maintenanceStartsAt',
        'updatedAt',
    ]),
}

function nameOf(source: AuditModelFields) {
    const name = source.id?.split('.')[0]
    if (!name) throw new Error('Unknown test table')
    return name
}

function project(row: AuditModelRow, fields?: AuditModelFields) {
    if (!fields) return structuredClone(row)
    return Object.fromEntries(
        Object.entries(fields).map(([key, column]) => [
            key,
            row[column.split('.').at(-1) ?? ''],
        ]),
    )
}

export function createAuditTransactionTestModel() {
    const state: AuditModelState = {
        rows: new Map(),
        audits: [],
        events: [],
        active: false,
        lockedUsers: new Set(),
        nextAuditId: 1,
        auditCreatedAt: new Date('2026-09-06T12:00:00Z'),
        retentionReadLimits: [],
        deletedAuditIds: [],
        failPrune: false,
        failAction: null,
        failCommit: false,
        failPublish: false,
        emptyReturning: false,
        auditReceipts: null,
    }

    function requireTransaction() {
        if (!state.active) throw new Error('Operation escaped its transaction')
    }

    function select(fields?: AuditModelFields) {
        let name = ''
        let predicate: AuditModelPredicate | undefined
        let order: Array<AuditModelOrder> = []
        let rowLimit = Number.POSITIVE_INFINITY
        function read() {
            requireTransaction()
            state.events.push('read:' + name)
            if (name === 'auditLogs') {
                requireAuditActorLock(state, predicate)
                state.retentionReadLimits.push(rowLimit)
                return state.audits
                    .filter((row) => auditPredicateMatches(row, predicate))
                    .toSorted((left, right) =>
                        compareAuditModelRows(left, right, order),
                    )
                    .slice(0, rowLimit)
                    .map((row) => project(row, fields))
            }
            const row =
                name === 'users'
                    ? {
                          id:
                              auditPredicateEquality(predicate, 'users.id') ??
                              AUDIT_TEST_ACTOR,
                      }
                    : state.rows.get(name)
            return row ? [project(row, fields)] : []
        }
        const chain = {
            from(source: AuditModelFields) {
                name = nameOf(source)
                return chain
            },
            where(condition: AuditModelPredicate) {
                predicate = condition
                return chain
            },
            orderBy(...columns: Array<AuditModelOrder>) {
                order = columns
                return chain
            },
            limit(count: number) {
                rowLimit = count
                return chain
            },
            async for(mode: string) {
                const id = auditPredicateEquality(predicate, 'users.id')
                state.events.push(
                    'lock:' + name + ':' + String(id) + ':' + mode,
                )
                if (
                    name === 'users' &&
                    mode === 'update' &&
                    typeof id === 'string'
                )
                    state.lockedUsers.add(id)
                return read()
            },

            ...createLazyTestQuery(() => Promise.resolve().then(read)),
        }
        return chain
    }

    function insert(source: AuditModelFields) {
        const name = nameOf(source)
        let values: AuditModelRow = {}
        let conflict: AuditModelRow | undefined
        let ignoreConflict = false
        function persist(fields?: AuditModelFields) {
            requireTransaction()
            state.events.push('insert:' + name)
            if (name === 'auditLogs') {
                if (values.action === state.failAction)
                    throw new Error('synthetic audit failure')
                const row = {
                    ...structuredClone(values),
                    id: 'audit-' + state.nextAuditId++,
                    createdAt: new Date(state.auditCreatedAt),
                } as AuditModelAuditRow
                state.audits.push(row)
                return state.auditReceipts ?? [project(row, fields)]
            }
            const existing = state.rows.get(name)
            const row =
                existing && ignoreConflict
                    ? existing
                    : {
                          ...existing,
                          ...(existing ? (conflict ?? values) : values),
                      }
            state.rows.set(name, row)
            return state.emptyReturning ? [] : [project(row, fields)]
        }
        const chain = {
            values(data: AuditModelRow) {
                values = data
                return chain
            },
            onConflictDoUpdate(options: { set: AuditModelRow }) {
                conflict = options.set
                return chain
            },
            onConflictDoNothing() {
                ignoreConflict = true
                return chain
            },
            async returning(fields?: AuditModelFields) {
                return persist(fields)
            },

            ...createLazyTestQuery(() =>
                Promise.resolve().then(() => persist()),
            ),
        }
        return chain
    }

    function update(source: AuditModelFields) {
        const name = nameOf(source)
        let values: AuditModelRow = {}
        const chain = {
            set(data: AuditModelRow) {
                values = data
                return chain
            },
            where(_condition: AuditModelPredicate) {
                return chain
            },
            async returning(fields?: AuditModelFields) {
                requireTransaction()
                state.events.push('update:' + name)
                const existing = state.rows.get(name)
                if (!existing) return []
                const row = { ...existing, ...values }
                state.rows.set(name, row)
                return state.emptyReturning ? [] : [project(row, fields)]
            },
        }
        return chain
    }

    function deleteRows(source: AuditModelFields) {
        const name = nameOf(source)
        return {
            async where(predicate: AuditModelPredicate) {
                requireTransaction()
                if (name !== 'auditLogs')
                    throw new Error('Unexpected test delete')
                requireAuditActorLock(state, predicate)
                state.events.push('delete:auditLogs')
                const deleted = state.audits.filter((row) =>
                    auditPredicateMatches(row, predicate),
                )
                state.deletedAuditIds.push(...deleted.map((row) => row.id))
                state.audits = state.audits.filter(
                    (row) => !auditPredicateMatches(row, predicate),
                )
                if (state.failPrune) throw new Error('synthetic prune failure')
            },
        }
    }

    const tx = { select, insert, update, delete: deleteRows }
    const transactionContext = new AsyncLocalStorage<boolean>()
    let transactionTail = Promise.resolve()
    const database = {
        transaction: vi.fn(async function <T>(
            operation: (transaction: typeof tx) => Promise<T>,
        ) {
            if (transactionContext.getStore())
                throw new Error('Nested test transaction')

            const previous = transactionTail
            const turn = Promise.withResolvers<void>()
            transactionTail = turn.promise
            await previous
            return transactionContext.run(true, async function () {
                const rows = structuredClone(state.rows)
                const audits = structuredClone(state.audits)
                state.active = true
                state.events.push('begin')
                try {
                    const result = await operation(tx)
                    if (state.failCommit)
                        throw new Error('synthetic commit failure')
                    state.events.push('commit')
                    return result
                } catch (error) {
                    state.rows = rows
                    state.audits = audits
                    state.events.push('rollback')
                    throw error
                } finally {
                    state.active = false
                    state.lockedUsers.clear()
                    turn.resolve()
                }
            })
        }),
    }
    const publish = vi.fn(async function (_data: unknown) {
        if (transactionContext.getStore())
            throw new Error('Publication before commit')
        state.events.push('publish-audit')
        if (state.failPublish) throw new Error('synthetic publisher failure')
    })
    const logger = vi.fn()
    const header = vi.fn(
        () => 'https://example.test/settings?token=private#secret',
    )
    function reset() {
        state.rows.clear()
        state.audits = []
        state.events = []
        state.active = false
        state.lockedUsers.clear()
        state.nextAuditId = 1
        state.auditCreatedAt = new Date('2026-09-06T12:00:00Z')
        state.retentionReadLimits = []
        state.deletedAuditIds = []
        state.failPrune = false
        state.failAction = null
        state.failCommit = false
        state.failPublish = false
        state.emptyReturning = false
        state.auditReceipts = null
        vi.clearAllMocks()
    }
    function install() {
        vi.mock('@/db', () => ({ db: database }))
        vi.mock('@/db/schema.ts', () => auditTestSchema)
        vi.mock('drizzle-orm', () => ({
            eq: (column: string, value: unknown): AuditModelPredicate => ({
                kind: 'eq',
                column,
                value,
            }),
            ne: (column: string, value: unknown): AuditModelPredicate => ({
                kind: 'ne',
                column,
                value,
            }),
            inArray: (
                column: string,
                values: Array<unknown>,
            ): AuditModelPredicate => ({
                kind: 'in',
                column,
                values,
            }),
            and: (
                ...conditions: Array<AuditModelPredicate>
            ): AuditModelPredicate => ({
                kind: 'and',
                conditions,
            }),
            asc: (column: string): AuditModelOrder => ({
                column,
                direction: 'asc',
            }),
        }))
        vi.mock('@tanstack/react-start/server', () => ({
            getRequestHeader: header,
        }))
        vi.mock('@/server/Realtime/publish.service.ts', () => ({
            publishAuditLogCreatedService: publish,
        }))
        vi.mock('@/server/Logging/logger.ts', () => ({ logError: logger }))
    }
    return { state, tx, database, publish, logger, header, reset, install }
}
