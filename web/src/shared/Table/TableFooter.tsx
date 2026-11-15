import { CustomSelect } from '@rentnerkev/select'
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
} from 'lucide-react'
import type { RowData } from '@tanstack/react-table'
import type { TableRowFilterFooterProps } from '@/shared/Table/Types/table.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function TableFooter<TData extends RowData>({
    table,
    columnCount,
    itemLabel,
    pageSizeOptions,
}: TableRowFilterFooterProps<TData>) {
    const { t } = useTranslationStore()

    return (
        <tfoot>
            <tr className="border-t border-border-dark bg-background-dark/25">
                <td colSpan={columnCount} className="px-5 py-4">
                    <table.Subscribe
                        selector={(state) => ({
                            columnFilters: state.columnFilters,
                            globalFilter: state.globalFilter,
                            pagination: state.pagination,
                        })}
                    >
                        {({ pagination }) => {
                            const { pageIndex, pageSize } = pagination
                            const filteredRowsCount = table.getRowCount()
                            const currentRowsCount =
                                table.getRowModel().rows.length
                            const firstRowNumber =
                                filteredRowsCount === 0
                                    ? 0
                                    : pageIndex * pageSize + 1
                            const lastRowNumber = Math.min(
                                filteredRowsCount,
                                pageIndex * pageSize + currentRowsCount,
                            )

                            return (
                                <div className="flex flex-col gap-4 text-sm text-secondary-text lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        {t('shared.table.rowRange', {
                                            firstRowNumber,
                                            lastRowNumber,
                                            filteredRowsCount,
                                            itemLabel,
                                        })}
                                    </div>

                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                        <label className="flex items-center gap-2">
                                            <span>
                                                {t('shared.table.rowsPerPage')}
                                            </span>
                                            <div className="w-auto">
                                                <CustomSelect
                                                    value={pageSize}
                                                    placeholder={t(
                                                        'shared.table.amount',
                                                    )}
                                                    onValueChange={(value) => {
                                                        table.setPageSize(value)
                                                        table.firstPage()
                                                    }}
                                                    options={pageSizeOptions}
                                                    controlSize="sm"
                                                />
                                            </div>
                                        </label>

                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    table.firstPage()
                                                }
                                                disabled={
                                                    !table.getCanPreviousPage()
                                                }
                                                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label={t(
                                                    'shared.table.firstPage',
                                                )}
                                            >
                                                <ChevronsLeft className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    table.previousPage()
                                                }
                                                disabled={
                                                    !table.getCanPreviousPage()
                                                }
                                                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label={t(
                                                    'shared.table.previousPage',
                                                )}
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                            </button>

                                            <span className="min-w-24 text-center text-white">
                                                {t('shared.table.pageInfo', {
                                                    currentPage: pageIndex + 1,
                                                    totalPages:
                                                        table.getPageCount() ||
                                                        1,
                                                })}
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() => table.nextPage()}
                                                disabled={
                                                    !table.getCanNextPage()
                                                }
                                                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label={t(
                                                    'shared.table.nextPage',
                                                )}
                                            >
                                                <ChevronRight className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => table.lastPage()}
                                                disabled={
                                                    !table.getCanNextPage()
                                                }
                                                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label={t(
                                                    'shared.table.lastPage',
                                                )}
                                            >
                                                <ChevronsRight className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )
                        }}
                    </table.Subscribe>
                </td>
            </tr>
        </tfoot>
    )
}
