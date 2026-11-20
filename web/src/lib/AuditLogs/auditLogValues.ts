import type { AuditCompareRow } from './Types/audit-value.types.ts'
import type {
    AuditLogEntry,
    AuditLogJsonRecord,
} from './Types/auditLog.types.ts'

export function getAuditCompareRows(auditLog: AuditLogEntry) {
    const oldValues: AuditLogJsonRecord = auditLog.oldValues ?? {}
    const newValues: AuditLogJsonRecord = auditLog.newValues ?? {}

    return Array.from(
        new Set([...Object.keys(oldValues), ...Object.keys(newValues)]),
    )
        .toSorted()
        .flatMap((key): Array<AuditCompareRow> => {
            const oldValue = oldValues[key]
            const newValue = newValues[key]
            return isSameAuditValue(oldValue, newValue)
                ? []
                : [{ key, oldValue, newValue }]
        })
}

export function formatAuditValue(value: unknown) {
    if (value === undefined || value === '') return '—'
    if (value === null) return 'null'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }
    return JSON.stringify(value, null, 2)
}

function isSameAuditValue(oldValue: unknown, newValue: unknown) {
    return JSON.stringify(oldValue) === JSON.stringify(newValue)
}
