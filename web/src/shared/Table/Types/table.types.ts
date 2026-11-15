import type {
    ClientTable,
    ClientTableFeatures,
} from '@/shared/Table/Types/client-table.types.ts'

import type {
    Cell,
    Column,
    HeaderGroup,
    Row,
    RowData,
} from '@tanstack/react-table'
import type { ReactNode } from 'react'

export type TableFilterOption<TValue = string> = {
    value: TValue
    label: string
}

export type TableDateRangeFilterValue = {
    from?: string
    to?: string
}

export type TableHeadProps<TData extends RowData> = {
    table: ClientTable<TData>
    showColumnFilters: boolean
    columnFilterConfigs: TableColumnFilterConfigs
}

type TableColumnFilterConfig =
    | {
          type: 'text'
          placeholder?: string
          maxLength?: number
      }
    | {
          type: 'select'
          placeholder?: string
          options: Array<TableFilterOption>
      }
    | {
          type: 'dateRange'
          placeholder?: string
      }

export type TableBodyStateConfig = {
    icon?: ReactNode
    title?: ReactNode
    description?: ReactNode
    iconWrapperClassName?: string
    titleClassName?: string
    descriptionClassName?: string
}

export type TableBodyProps<TData extends RowData> = {
    table: ClientTable<TData>
    columnCount: number
    isLoading?: boolean
    searchInput?: string
    loadingState?: TableBodyStateConfig
    emptyState?: TableBodyStateConfig
    searchEmptyState?: TableBodyStateConfig
    rowClassName?: string | ((row: Row<ClientTableFeatures, TData>) => string)
    cellClassName?:
        string | ((cell: Cell<ClientTableFeatures, TData>) => string)
    renderExpandedRow?: (row: Row<ClientTableFeatures, TData>) => ReactNode
}

export type TableBodyStateProps = {
    columnCount: number
    state: TableBodyStateConfig
    className?: string
}

export type TableColumnFilterConfigs = Record<string, TableColumnFilterConfig>

export type TableColumnFiltersProps<TData extends RowData> = {
    headerGroup: HeaderGroup<ClientTableFeatures, TData>
    filterConfigs?: TableColumnFilterConfigs
}

export type TableColumnFilterInputProps<TData extends RowData> = {
    column: Column<ClientTableFeatures, TData>
    config: TableColumnFilterConfig
}

export type TableFilterToggleButtonProps = {
    isActive: boolean
    onClick: () => void
}

export type TableSearchToolbarProps<TData extends RowData> = {
    table: ClientTable<TData>
    value: string
    placeholder: string
    showColumnFilters: boolean
    onChange: (value: string) => void
    onToggleFilters: () => void
    maxLength?: number
}

export type TableRowFilterFooterProps<TData extends RowData> = {
    table: ClientTable<TData>
    columnCount: number
    itemLabel: string
    pageSizeOptions: Array<TableFilterOption<number>>
}
