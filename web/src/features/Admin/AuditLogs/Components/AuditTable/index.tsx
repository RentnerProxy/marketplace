import TableFooter from '@/shared/Table/TableFooter.tsx'
import TableSearchToolbar from '@/shared/Table/TableSearchToolbar.tsx'
import TableHead from '@/shared/Table/TableHead.tsx'
import TableBody from '@/shared/Table/TableBody.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { ScrollText } from 'lucide-react'
import useAuditTableLogic from './Hooks/useAuditTableLogic.ts'
import type { AuditTableProps } from './Types/audit-table.types.ts'
import { AuditLogDetailsRow } from './Components/AuditLogDetailsRow.tsx'

export default function AuditTable(props: AuditTableProps) {
    const { t } = useTranslationStore()
    const { state, handler, table } = useAuditTableLogic(props)
    const { isLoadingAuditLogs } = props

    return (
        <section className="rounded-xl border border-border-dark bg-surface-dark">
            <div className="flex flex-col gap-4 border-b border-border-dark px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                    <HeadingIcon icon={ScrollText} />
                    <div>
                        <h2 className="text-lg font-bold text-white">
                            {t('admin.auditLogs.entriesTitle')}
                        </h2>

                        <p className="text-sm text-secondary-text">
                            {t('admin.auditLogs.entriesDescription')}
                        </p>
                    </div>
                </div>

                <TableSearchToolbar
                    table={table}
                    value={state.searchInput}
                    placeholder={t('admin.auditLogs.searchPlaceholder')}
                    showColumnFilters={state.showColumnFilters}
                    onChange={handler.handleSearchInputChange}
                    onToggleFilters={handler.handleToggleColumnFilters}
                />
            </div>

            <div className="overflow-x-auto">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                    <TableHead
                        table={table}
                        showColumnFilters={state.showColumnFilters}
                        columnFilterConfigs={state.columnFilterConfigs}
                    />

                    <TableBody
                        table={table}
                        columnCount={state.columnCount}
                        isLoading={isLoadingAuditLogs}
                        searchInput={state.searchInput}
                        renderExpandedRow={(row) =>
                            state.expandedAuditLogId === row.original.id ? (
                                <AuditLogDetailsRow
                                    auditLog={row.original}
                                    columnCount={state.columnCount}
                                />
                            ) : null
                        }
                    />

                    <TableFooter
                        table={table}
                        columnCount={state.columnCount}
                        itemLabel={t('admin.auditLogs.itemLabel')}
                        pageSizeOptions={state.auditRowsOptions}
                    />
                </table>
            </div>
        </section>
    )
}
