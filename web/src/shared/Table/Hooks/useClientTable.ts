import type {
    ClientTableHookReturn,
    UseClientTableOptions,
} from '../Types/client-table.types.ts'

import { useEffect, useState } from 'react'
import {
    columnFilteringFeature,
    columnSizingFeature,
    createFilteredRowModel,
    createPaginatedRowModel,
    createSortedRowModel,
    filterFn_includesString,
    globalFilteringFeature,
    rowPaginationFeature,
    rowSortingFeature,
    sortFn_alphanumeric,
    sortFn_text,
    tableFeatures,
    useTable,
} from '@tanstack/react-table'
import type { RowData } from '@tanstack/react-table'

import { useDebounce } from '@/shared/Hooks/useDebounce.ts'

export const clientTableFeatures = tableFeatures({
    columnSizingFeature,
    columnFilteringFeature,
    globalFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
    filterFns: {
        includesString: filterFn_includesString,
    },
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    sortFns: {
        alphanumeric: sortFn_alphanumeric,
        text: sortFn_text,
    },
    rowPaginationFeature,
    paginatedRowModel: createPaginatedRowModel(),
})

export default function useClientTable<TData extends RowData>({
    data,
    columns,
    getRowId,
    initialSorting,
    globalFilterFn,
}: UseClientTableOptions<TData>): ClientTableHookReturn<TData> {
    const [searchInput, setSearchInput] = useState('')
    const debouncedSearch = useDebounce(searchInput, 300)

    const table = useTable(
        {
            features: clientTableFeatures,
            data,
            columns,
            getRowId,
            globalFilterFn: globalFilterFn ?? 'includesString',
            autoResetPageIndex: false,
            initialState: {
                sorting: initialSorting,
                pagination: { pageIndex: 0, pageSize: 10 },
            },
        },
        () => null,
    )

    const setGlobalFilter = table.setGlobalFilter
    const firstPage = table.firstPage
    const getPageCount = table.getPageCount
    const setPageIndex = table.setPageIndex
    const columnFiltersAtom = table.atoms.columnFilters
    const globalFilterAtom = table.atoms.globalFilter
    const paginationAtom = table.atoms.pagination
    const sortingAtom = table.atoms.sorting

    useEffect(() => {
        setGlobalFilter(debouncedSearch)
    }, [debouncedSearch, setGlobalFilter])

    useEffect(() => {
        const subscriptions = [
            columnFiltersAtom.subscribe(firstPage),
            globalFilterAtom.subscribe(firstPage),
            sortingAtom.subscribe(firstPage),
        ]

        return function () {
            subscriptions.forEach((subscription) => subscription.unsubscribe())
        }
    }, [columnFiltersAtom, firstPage, globalFilterAtom, sortingAtom])

    useEffect(() => {
        const lastPageIndex = Math.max(getPageCount() - 1, 0)
        const pageIndex = paginationAtom.get().pageIndex

        if (pageIndex > lastPageIndex) {
            setPageIndex(lastPageIndex)
        }
    }, [getPageCount, paginationAtom, setPageIndex])

    return {
        table,
        state: {
            searchInput,
        },
        handler: {
            handleSearchInputChange: setSearchInput,
        },
    }
}
