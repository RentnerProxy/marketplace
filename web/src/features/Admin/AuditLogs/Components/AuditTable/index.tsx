import { DataTable, type DataTableProps } from '@rentnerkev/table'
import { ScrollText } from 'lucide-react'
import { useState } from 'react'
import { TABLE_LOCALES } from '@/config/language-library.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { hasAuditJsonValue } from '@/lib/AuditLogs/auditLogValues.ts'
import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'
import { getMarketplaceTableMessages } from '@/lib/Table/tableMessages.ts'
import { AuditLogDetails } from './Components/AuditLogDetails.tsx'
import useAuditTableColumns from './Hooks/useAuditTableColumns.tsx'
import type { AuditTableProps } from './Types/audit-table.types.ts'

const pageSizes = [10, 20, 50, 100]

export default function AuditTable({
    auditLogs,
    isLoadingAuditLogs,
}: AuditTableProps) {
    const { language, t } = useTranslationStore()
    const columns = useAuditTableColumns(auditLogs)
    const [expanded, setExpanded] = useState<Record<string, boolean>>({})
    const tableOptions: DataTableProps<AuditLogEntry>['tableOptions'] = {
        initialState: { sorting: [{ id: 'createdAt', desc: true }] },
        state: { expanded },
        autoResetExpanded: false,
        getRowCanExpand: ({ original }) =>
            hasAuditJsonValue(original.oldValues) ||
            hasAuditJsonValue(original.newValues),
        onExpandedChange: (update) =>
            setExpanded((current) => {
                const next =
                    typeof update === 'function' ? update(current) : update
                if (next === true) return current

                const rowId =
                    Object.keys(next).find((id) => next[id] && !current[id]) ??
                    Object.keys(next).find((id) => next[id])
                return rowId ? { [rowId]: true } : {}
            }),
    }

    return (
        <DataTable
            locale={TABLE_LOCALES[language]}
            messages={{
                ...getMarketplaceTableMessages(
                    t,
                    t('admin.auditLogs.itemLabel'),
                ),
                expandRow: (label) =>
                    label
                        ? `${t('admin.auditLogs.showDetails')} (${label})`
                        : t('admin.auditLogs.details'),
            }}
            data={auditLogs}
            columns={columns}
            getRowId={(entry) => entry.id}
            getRowLabel={(entry) => `${entry.action}, ${entry.id}`}
            tableOptions={tableOptions}
            pageSizeOptions={pageSizes}
            classNames={{ table: 'min-w-[940px]' }}
            isLoading={isLoadingAuditLogs}
            title={t('admin.auditLogs.entriesTitle')}
            description={t('admin.auditLogs.entriesDescription')}
            icon={<ScrollText className="size-5" />}
            searchPlaceholder={t('admin.auditLogs.searchPlaceholder')}
            renderExpandedRow={({ original }) => (
                <AuditLogDetails auditLog={original} />
            )}
            columnSettings
            resizableColumns
            striped
        />
    )
}
