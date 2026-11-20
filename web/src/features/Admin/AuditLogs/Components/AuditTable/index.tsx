import { DataTable, type DataTableProps } from '@rentnerkev/table'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'
import { authenticatedTableLayout } from '@/lib/Table/authenticatedTableStyles.ts'
import {
    getMarketplaceTableDateRangeOptions,
    getMarketplaceTableLocale,
} from '@/lib/Table/tableMessages.ts'
import RowDetailsDialog from '@/shared/Table/RowDetailsDialog.tsx'
import { AuditLogDetails } from './Components/AuditLogDetails.tsx'
import useAuditTableLogic from './Hooks/useAuditTableLogic.tsx'
import type { AuditTableProps } from './Types/audit-table.types.ts'

const pageSizes = [10, 20, 50, 100]
const tableOptions: DataTableProps<AuditLogEntry>['tableOptions'] = {
    initialState: { sorting: [{ id: 'createdAt', desc: true }] },
}

export default function AuditTable({
    auditLogs,
    isLoadingAuditLogs,
}: AuditTableProps) {
    const { language, t } = useTranslationStore()
    const { state, handler } = useAuditTableLogic()

    return (
        <>
            <DataTable
                {...authenticatedTableLayout}
                locale={getMarketplaceTableLocale(
                    language,
                    t,
                    t('admin.auditLogs.itemLabel'),
                )}
                data={auditLogs}
                columns={state.columns}
                getRowId={(entry) => entry.id}
                tableOptions={tableOptions}
                pageSizeOptions={pageSizes.map((count) => ({
                    value: count,
                    label: t('admin.auditLogs.entryCount', { count }),
                }))}
                dateRangeOptions={getMarketplaceTableDateRangeOptions(language)}
                isLoading={isLoadingAuditLogs}
                title={t('admin.auditLogs.entriesTitle')}
                description={t('admin.auditLogs.entriesDescription')}
                searchPlaceholder={t('admin.auditLogs.searchPlaceholder')}
                columnSettings
                resizableColumns
            />
            {state.selectedEntry && (
                <RowDetailsDialog
                    title={t('admin.auditLogs.details')}
                    onClose={handler.handleCloseDetails}
                >
                    <AuditLogDetails auditLog={state.selectedEntry} />
                </RowDetailsDialog>
            )}
        </>
    )
}
