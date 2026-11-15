import type { RowData } from '@tanstack/react-table'
import { ArrowUpDown } from 'lucide-react'
import { Fragment } from 'react'

import TableColumnFilters from '@/shared/Table/TableColumnFilters.tsx'
import type { TableHeadProps } from '@/shared/Table/Types/table.types.ts'
import { getColumnSizeStyle } from '@/lib/Table/tableFilters.ts'

export default function TableHead<TData extends RowData>({
    table,
    showColumnFilters,
    columnFilterConfigs,
}: TableHeadProps<TData>) {
    return (
        <thead className="border-b-2 border-primary bg-background-dark text-xs text-foreground">
            <table.Subscribe
                selector={(state) => ({
                    sorting: state.sorting,
                    columnFilters: state.columnFilters,
                })}
            >
                {() =>
                    table.getHeaderGroups().map((headerGroup) => (
                        <Fragment key={headerGroup.id}>
                            <tr>
                                {headerGroup.headers.map((header) => (
                                    <th
                                        key={header.id}
                                        style={getColumnSizeStyle(
                                            header.column.getSize(),
                                        )}
                                        className="px-5 py-3"
                                    >
                                        <button
                                            type="button"
                                            disabled={
                                                !header.column.getCanSort()
                                            }
                                            onClick={header.column.getToggleSortingHandler()}
                                            className="flex w-full min-w-0 cursor-pointer items-center gap-2 font-semibold disabled:cursor-default"
                                        >
                                            <span className="min-w-0 truncate">
                                                <table.FlexRender
                                                    header={header}
                                                />
                                            </span>

                                            {header.column.getCanSort() && (
                                                <ArrowUpDown
                                                    className={`h-3.5 w-3.5 shrink-0 ${
                                                        header.column.getIsSorted()
                                                            ? 'text-primary'
                                                            : 'text-secondary-text'
                                                    }`}
                                                />
                                            )}
                                        </button>
                                    </th>
                                ))}
                            </tr>

                            {showColumnFilters && (
                                <TableColumnFilters
                                    headerGroup={headerGroup}
                                    filterConfigs={columnFilterConfigs}
                                />
                            )}
                        </Fragment>
                    ))
                }
            </table.Subscribe>
        </thead>
    )
}
