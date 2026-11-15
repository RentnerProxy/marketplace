import type { RowData } from '@tanstack/react-table'
import { Fragment } from 'react'
import { Inbox, RefreshCw, SearchX } from 'lucide-react'
import type {
    TableBodyProps,
    TableBodyStateConfig,
} from '@/shared/Table/Types/table.types.ts'
import {
    getCellClassName,
    getColumnSizeStyle,
    getRowClassName,
} from '@/lib/Table/tableFilters.ts'
import { TableBodyState } from '@/shared/Table/TableBodyState.tsx'

export default function TableBody<TData extends RowData>({
    table,
    columnCount,
    isLoading = false,
    searchInput = '',
    loadingState,
    emptyState,
    searchEmptyState,
    rowClassName,
    cellClassName,
    renderExpandedRow,
}: TableBodyProps<TData>) {
    const hasSearchInput = searchInput.trim().length > 0

    if (isLoading) {
        return (
            <tbody>
                <TableBodyState
                    columnCount={columnCount}
                    className="px-5 py-12"
                    state={{
                        icon: (
                            <RefreshCw className="h-8 w-8 animate-spin text-secondary-text/50" />
                        ),
                        description: 'Lädt...',
                        iconWrapperClassName:
                            'mb-0 h-auto w-auto bg-transparent',
                        ...loadingState,
                    }}
                />
            </tbody>
        )
    }

    return (
        <tbody>
            <table.Subscribe
                selector={(state) => ({
                    sorting: state.sorting,
                    columnFilters: state.columnFilters,
                    globalFilter: state.globalFilter,
                    pagination: state.pagination,
                })}
            >
                {() => {
                    const rows = table.getRowModel().rows

                    if (rows.length === 0) {
                        const fallbackEmptyState: TableBodyStateConfig =
                            hasSearchInput
                                ? {
                                      icon: (
                                          <SearchX className="h-8 w-8 text-secondary-text" />
                                      ),
                                      title: 'Keine Ergebnisse gefunden',
                                      description:
                                          'Zu deiner Suche wurden keine Einträge gefunden.',
                                      ...searchEmptyState,
                                  }
                                : {
                                      icon: (
                                          <Inbox className="h-8 w-8 text-secondary-text" />
                                      ),
                                      title: 'Keine Einträge vorhanden',
                                      description:
                                          'Aktuell gibt es keine Daten für diese Tabelle.',
                                      ...emptyState,
                                  }

                        return (
                            <TableBodyState
                                columnCount={columnCount}
                                state={fallbackEmptyState}
                            />
                        )
                    }

                    return rows.map((row) => (
                        <Fragment key={row.id}>
                            <tr className={getRowClassName(row, rowClassName)}>
                                {row.getAllCells().map((cell) => (
                                    <td
                                        key={cell.id}
                                        style={getColumnSizeStyle(
                                            cell.column.getSize(),
                                        )}
                                        className={getCellClassName(
                                            cell,
                                            cellClassName,
                                        )}
                                    >
                                        <div className="min-w-0">
                                            <table.FlexRender cell={cell} />
                                        </div>
                                    </td>
                                ))}
                            </tr>

                            {renderExpandedRow?.(row)}
                        </Fragment>
                    ))
                }}
            </table.Subscribe>
        </tbody>
    )
}
