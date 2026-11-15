import type {
    ReactTable,
    RowData,
    ColumnDef,
    FilterFn,
    SortingState,
} from '@tanstack/react-table'

import type { clientTableFeatures } from '../Hooks/useClientTable.ts'

export type ClientTableFeatures = typeof clientTableFeatures

export type ClientTable<TData extends RowData> = ReactTable<
    ClientTableFeatures,
    TData,
    null
>

export type UseClientTableOptions<TData extends RowData> = {
    data: Array<TData>
    columns: Array<ColumnDef<ClientTableFeatures, TData>>
    getRowId: (row: TData) => string
    initialSorting: SortingState
    globalFilterFn?: FilterFn<ClientTableFeatures, TData>
}

export type ClientTableHookReturn<TData extends RowData> = {
    table: ClientTable<TData>
    state: {
        searchInput: string
    }
    handler: {
        handleSearchInputChange: (value: string) => void
    }
}
