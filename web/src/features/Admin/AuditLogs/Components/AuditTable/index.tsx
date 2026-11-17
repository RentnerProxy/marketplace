import { DataTable, type DataTableProps } from '@rentnerkev/table'
import { ScrollText } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { hasAuditJsonValue } from '@/lib/AuditLogs/auditLogValues.ts'
import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'
import {
    getMarketplaceTableDateRangeOptions,
    getMarketplaceTableLocale,
} from '@/lib/Table/tableMessages.ts'
import { AuditLogDetails } from './Components/AuditLogDetails.tsx'
import useAuditTableColumns from './Hooks/useAuditTableColumns.tsx'
import type { AuditTableProps } from './Types/audit-table.types.ts'

const pageSizes = [10, 20, 50, 100]
const tableOptions: DataTableProps<AuditLogEntry>['tableOptions'] = {
    initialState: { sorting: [{ id: 'createdAt', desc: true }] },
    getRowCanExpand: ({ original }) =>
        hasAuditJsonValue(original.oldValues) ||
        hasAuditJsonValue(original.newValues),
}

export default function AuditTable({
    auditLogs,
    isLoadingAuditLogs,
}: AuditTableProps) {
    const { language, t } = useTranslationStore()
    const columns = useAuditTableColumns()

    return (
        <DataTable
            locale={getMarketplaceTableLocale(
                language,
                t,
                t('admin.auditLogs.itemLabel'),
                {
                    expandRow: (label) =>
                        label
                            ? `${t('admin.auditLogs.showDetails')} (${label})`
                            : t('admin.auditLogs.details'),
                },
            )}
            data={auditLogs}
            columns={columns}
            getRowId={(entry) => entry.id}
            getRowLabel={(entry) => `${entry.action}, ${entry.id}`}
            tableOptions={tableOptions}
            pageSizeOptions={pageSizes.map((count) => ({
                value: count,
                label: t('admin.auditLogs.entryCount', { count }),
            }))}
            columnWidthMode="scroll"
            dateRangeOptions={getMarketplaceTableDateRangeOptions(language)}
            expansionMode="single"
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
