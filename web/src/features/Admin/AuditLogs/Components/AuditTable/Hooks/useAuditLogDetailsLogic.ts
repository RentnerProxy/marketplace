import { useMemo } from 'react'
import {
    formatAuditValue,
    getAuditCompareRows,
} from '@/lib/AuditLogs/auditLogValues.ts'
import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'
import type { AuditLogDetailsLogicReturn } from '../Types/audit-table.types.ts'

export default function useAuditLogDetailsLogic(
    auditLog: AuditLogEntry,
): AuditLogDetailsLogicReturn {
    const rows = useMemo(
        () =>
            getAuditCompareRows(auditLog).map((row) => ({
                key: row.key,
                oldValue: formatAuditValue(row.oldValue),
                newValue: formatAuditValue(row.newValue),
            })),
        [auditLog],
    )

    return { state: { rows } }
}
