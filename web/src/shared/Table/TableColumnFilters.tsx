import { RangeCalendar } from '@rentnerkev/calendar'
import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import type { RowData } from '@tanstack/react-table'
import type {
    TableColumnFilterInputProps,
    TableColumnFiltersProps,
} from '@/shared/Table/Types/table.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    getCalendarRangeFilterValue,
    getDateRangeFilterValue,
} from '@/lib/Date/date.ts'

const EMPTY_COLUMN_FILTER_CONFIGS = {}

function stringFilterValue(value: unknown, fallback: string): string {
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
    )
        return String(value)

    return fallback
}

function TableColumnFilterInput<TData extends RowData>({
    column,
    config,
}: TableColumnFilterInputProps<TData>) {
    const { t, language } = useTranslationStore()

    if (config.type === 'select') {
        const filterValue = column.getFilterValue()

        return (
            <CustomSelect
                controlSize="sm"
                value={
                    filterValue == null
                        ? null
                        : stringFilterValue(filterValue, '')
                }
                placeholder={config.placeholder ?? t('common.all')}
                onValueChange={(value) => column.setFilterValue(value)}
                options={config.options}
                clearable
                emptyValue=""
                className="min-w-0 w-full rounded-md"
            />
        )
    }

    if (config.type === 'dateRange') {
        const value = getDateRangeFilterValue(column)

        return (
            <RangeCalendar
                controlSize="sm"
                locale={language}
                value={[value.from ?? null, value.to ?? null]}
                onChange={(calendarValue) =>
                    column.setFilterValue(
                        getCalendarRangeFilterValue(calendarValue),
                    )
                }
                placeholder={
                    config.placeholder ?? t('shared.table.dateRangePlaceholder')
                }
                className="min-w-40 rounded-md"
                backdrop
                fastEdit
                weekStartsOn={1}
                showHolidays
                isDeletable
            />
        )
    }

    return (
        <TextInput
            controlSize="sm"
            value={stringFilterValue(column.getFilterValue(), '')}
            maxLength={config.maxLength}
            onValueChange={(value) => column.setFilterValue(value)}
            placeholder={
                config.placeholder ?? t('shared.table.filterPlaceholder')
            }
            className="min-w-0 w-full rounded-md"
        />
    )
}

export default function TableColumnFilters<TData extends RowData>({
    headerGroup,
    filterConfigs = EMPTY_COLUMN_FILTER_CONFIGS,
}: TableColumnFiltersProps<TData>) {
    const { t } = useTranslationStore()

    return (
        <tr>
            {headerGroup.headers.map((header) => {
                const config = filterConfigs[header.column.id] ?? {
                    type: 'text',
                    placeholder: t('shared.table.filterColumnPlaceholder', {
                        column: String(header.column.columnDef.header ?? ''),
                    }),
                }

                return (
                    <th
                        key={`${header.id}-filter`}
                        className="border-t border-border-dark px-5 py-3"
                    >
                        {header.column.getCanFilter() ? (
                            <TableColumnFilterInput
                                column={header.column}
                                config={config}
                            />
                        ) : (
                            <span className="block h-9" />
                        )}
                    </th>
                )
            })}
        </tr>
    )
}
