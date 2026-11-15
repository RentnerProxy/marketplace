import type {
    AuditModelOrder,
    AuditModelPredicate,
    AuditModelRow,
    AuditModelState,
} from './audit-transaction.test.types.ts'

function fieldValue(row: AuditModelRow, column: string): unknown {
    return row[column.split('.').at(-1) ?? '']
}

export function auditPredicateMatches(
    row: AuditModelRow,
    predicate: AuditModelPredicate | undefined,
): boolean {
    if (!predicate) return true
    if (predicate.kind === 'and')
        return predicate.conditions.every((condition) =>
            auditPredicateMatches(row, condition),
        )
    const value = fieldValue(row, predicate.column)
    if (predicate.kind === 'in') return predicate.values.includes(value)
    return predicate.kind === 'eq'
        ? value === predicate.value
        : value !== predicate.value
}

export function auditPredicateEquality(
    predicate: AuditModelPredicate | undefined,
    column: string,
): unknown {
    if (!predicate) return undefined
    if (predicate.kind === 'and') {
        for (const condition of predicate.conditions) {
            const value = auditPredicateEquality(condition, column)
            if (value !== undefined) return value
        }
        return undefined
    }
    return predicate.kind === 'eq' && predicate.column === column
        ? predicate.value
        : undefined
}

export function requireAuditActorLock(
    state: AuditModelState,
    predicate: AuditModelPredicate | undefined,
): void {
    const actor = auditPredicateEquality(predicate, 'auditLogs.actorUserId')
    if (typeof actor !== 'string' || !state.lockedUsers.has(actor))
        throw new Error('Audit retention requires the caller actor lock')
}

export function compareAuditModelRows(
    left: AuditModelRow,
    right: AuditModelRow,
    order: Array<AuditModelOrder>,
): number {
    for (const item of order) {
        const first = fieldValue(left, item.column)
        const second = fieldValue(right, item.column)
        const result =
            first instanceof Date && second instanceof Date
                ? first.getTime() - second.getTime()
                : String(first).localeCompare(String(second))
        if (result !== 0) return result
    }
    return 0
}
