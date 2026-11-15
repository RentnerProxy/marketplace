import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { Cell, FilterFn, Row, RowData } from '@tanstack/react-table'

import { isRecord } from '@/lib/Validation/isRecord.ts'
import type { CSSProperties } from 'react'

function getDateTimestamp(value: unknown) {
    if (value instanceof Date) {
        return value.getTime()
    }

    if (typeof value !== 'string' && typeof value !== 'number') {
        return Number.NaN
    }

    return new Date(value).getTime()
}

function getInputDateTimestamp(value: string | undefined, endOfMinute = false) {
    if (!value) {
        return null
    }

    const date = new Date(value)

    if (endOfMinute) {
        date.setSeconds(59, 999)
    }

    return date.getTime()
}

function filterTrimmedIncludesString<TData extends RowData>(
    row: Row<ClientTableFeatures, TData>,
    columnId: string,
    filterValue: unknown,
) {
    const rowValue = row.getValue(columnId)

    const searchableValue =
        typeof rowValue === 'string' ||
        typeof rowValue === 'number' ||
        typeof rowValue === 'boolean' ||
        typeof rowValue === 'bigint'
            ? String(rowValue)
            : rowValue instanceof Date
              ? rowValue.toString()
              : ''

    return searchableValue.toLowerCase().includes(String(filterValue))
}

export function createTrimmedIncludesStringFilter<
    TData extends RowData,
>(): FilterFn<ClientTableFeatures, TData> {
    const filter: FilterFn<ClientTableFeatures, TData> =
        filterTrimmedIncludesString

    filter.resolveFilterValue = (value) => String(value).trim().toLowerCase()
    filter.autoRemove = (value) => !String(value).trim()

    return filter
}

export function createTimestampRangeFilter<TData extends RowData>(): FilterFn<
    ClientTableFeatures,
    TData
> {
    return function (row, columnId, filterValue) {
        const value = isRecord(filterValue) ? filterValue : null
        const from = typeof value?.from === 'string' ? value.from : undefined
        const to = typeof value?.to === 'string' ? value.to : undefined
        const fromTimestamp = getInputDateTimestamp(from)
        const toTimestamp = getInputDateTimestamp(to, true)
        const rowTimestamp = getDateTimestamp(row.getValue(columnId))

        if (Number.isNaN(rowTimestamp)) {
            return false
        }

        if (fromTimestamp !== null && rowTimestamp < fromTimestamp) {
            return false
        }

        return !(toTimestamp !== null && rowTimestamp > toTimestamp)
    }
}

export function mergeClassNames(
    ...classNames: Array<string | undefined | false>
) {
    return classNames.filter(Boolean).join(' ')
}

export function createSortedUniqueFilterOptions(
    values: Array<string | null | undefined>,
) {
    const uniqueValues = Array.from(
        new Set(values.filter((value): value is string => Boolean(value))),
    )
    uniqueValues.sort()
    return uniqueValues.map((value) => ({ value, label: value }))
}

export function getColumnSizeStyle(size: number): CSSProperties {
    return {
        width: `${size}px`,
        maxWidth: `${size}px`,
    }
}

export function getRowClassName<TData extends RowData>(
    row: Row<ClientTableFeatures, TData>,
    rowClassName?: string | ((row: Row<ClientTableFeatures, TData>) => string),
) {
    return mergeClassNames(
        'border-t border-border-dark transition-colors even:bg-background-dark/25 hover:bg-input-dark/60 hover:shadow-[inset_3px_0_0_var(--color-primary)]',
        typeof rowClassName === 'function' ? rowClassName(row) : rowClassName,
    )
}

export function getCellClassName<TData extends RowData>(
    cell: Cell<ClientTableFeatures, TData>,
    cellClassName?:
        string | ((cell: Cell<ClientTableFeatures, TData>) => string),
) {
    return mergeClassNames(
        'px-5 py-4 align-middle',
        typeof cellClassName === 'function'
            ? cellClassName(cell)
            : cellClassName,
    )
}
