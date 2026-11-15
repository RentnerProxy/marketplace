import type { DatabaseTransaction } from '@/lib/Database/Types/database.types.ts'
import { vi } from 'bun:test'
import type {
    AuditReceipt,
    AuditRequestMetadata,
    WriteAuditLogInput,
} from '@/lib/AuditLogs/Types/audit.types.ts'

export function createBackupAuditMocks() {
    const pending = new Map<unknown, Array<WriteAuditLogInput>>()
    const state = {
        events: [] as Array<string>,
        records: [] as Array<WriteAuditLogInput>,
        failAction: null as string | null,
        failPublish: false,
        failCommit: false,
    }
    const receipt: AuditReceipt = {
        id: '019f5b07-80e2-7000-8000-000000000099',
        createdAt: new Date('2026-09-06T10:00:00.000Z'),
    }
    const prepare = vi.fn(function (
        actorUserId: string | null,
        metadata: AuditRequestMetadata = {},
    ) {
        state.events.push('prepare')
        return {
            actorUserId,
            route: metadata.route ?? null,
            method: metadata.method ?? 'POST',
        }
    })
    const lockUsers = vi.fn(async function (
        transaction: DatabaseTransaction,
        _ids: Array<string | null>,
    ) {
        if (!pending.has(transaction))
            throw new Error('Actor locks must use the active transaction')
        state.events.push('actor-lock')
    })
    const write = vi.fn(async function (
        transaction: DatabaseTransaction,
        input: WriteAuditLogInput,
    ) {
        const transactionRecords = pending.get(transaction)
        if (!transactionRecords)
            throw new Error('Audit write escaped the active transaction')
        state.events.push('audit:' + input.action)
        if (state.failAction === input.action)
            throw new Error('synthetic audit insert failed')
        transactionRecords.push(structuredClone(input))
        return receipt
    })
    const publish = vi.fn(async function (_receipt: AuditReceipt) {
        state.events.push('publish-audit')
        if (state.failPublish)
            throw new Error('synthetic postcommit publication failed')
    })

    async function runTransaction<TTransaction, Result>(
        tx: TTransaction,
        operation: (transaction: TTransaction) => Result | Promise<Result>,
        rollback: () => void,
    ): Promise<Result> {
        pending.set(tx, [])
        state.events.push('begin')
        try {
            const result = await operation(tx)
            if (state.failCommit) throw new Error('synthetic commit failed')
            state.records.push(...(pending.get(tx) ?? []))
            state.events.push('commit')
            return result
        } catch (error) {
            rollback()
            state.events.push('rollback')
            throw error
        } finally {
            pending.delete(tx)
        }
    }

    function reset() {
        pending.clear()
        state.events = []
        state.records = []
        state.failAction = null
        state.failPublish = false
        state.failCommit = false
    }

    return {
        state,
        receipt,
        prepare,
        lockUsers,
        write,
        publish,
        transaction: runTransaction,
        reset,
    }
}

export function matchesBackupRunCondition(
    row: Record<string, unknown>,
    condition: unknown,
): boolean {
    if (!condition || typeof condition !== 'object' || !('type' in condition)) {
        throw new Error('Unknown backup query predicate')
    }
    if (
        condition.type === 'and' &&
        'conditions' in condition &&
        Array.isArray(condition.conditions)
    ) {
        return condition.conditions.every((child: unknown) =>
            matchesBackupRunCondition(row, child),
        )
    }
    if (
        !('left' in condition) ||
        typeof condition.left !== 'string' ||
        !('right' in condition)
    ) {
        throw new Error('Malformed backup query predicate')
    }
    const key = condition.left.split('.').at(-1)
    if (!key) throw new Error('Missing backup column')
    if (condition.type === 'eq') return row[key] === condition.right
    if (condition.type === 'inArray' && Array.isArray(condition.right))
        return condition.right.includes(row[key])
    throw new Error('Unsupported backup query predicate')
}
