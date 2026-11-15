import type { ClientTable } from '@/shared/Table/Types/client-table.types.ts'
import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'
import type {
    TableColumnFilterConfigs,
    TableFilterOption,
} from '@/shared/Table/Types/table.types.ts'

export type AuditTableProps = {
    auditLogs: Array<AuditLogEntry>
    isLoadingAuditLogs: boolean
}

export type UseAuditTableColumnsParams = {
    expandedAuditLogId: string | null
    onExpandedAuditLogIdChange: (auditLogId: string | null) => void
}

export type AuditLogDetailsRowProps = {
    auditLog: AuditLogEntry
    columnCount: number
}

export type AuditTableLogicReturn = {
    table: ClientTable<AuditLogEntry>
    state: {
        searchInput: string
        expandedAuditLogId: string | null
        showColumnFilters: boolean
        columnFilterConfigs: TableColumnFilterConfigs
        columnCount: number
        auditRowsOptions: Array<TableFilterOption<number>>
    }
    handler: {
        handleSearchInputChange: (filter: string) => void
        handleToggleColumnFilters: () => void
    }
}

export type AuditLogDetailsLogicReturn = {
    state: {
        rows: Array<{ key: string; oldValue: string; newValue: string }>
    }
}
