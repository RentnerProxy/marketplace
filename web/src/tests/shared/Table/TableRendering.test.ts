import { beforeEach, expect, it, vi } from 'bun:test'
import { createElement, Fragment } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import TableBody from '@/shared/Table/TableBody.tsx'
import TableHead from '@/shared/Table/TableHead.tsx'
import TableFooter from '@/shared/Table/TableFooter.tsx'
import TableSearchToolbar from '@/shared/Table/TableSearchToolbar.tsx'
import type {
    TableBodyProps,
    TableColumnFilterConfigs,
} from '@/shared/Table/Types/table.types.ts'
import type { ClientTable } from '@/shared/Table/Types/client-table.types.ts'

type Entry = { id: string; name: string; status: string; date: string }
type InputProps = {
    value?: unknown
    placeholder?: string
    onValueChange?: (value: unknown) => void
    onChange?: (value: unknown) => void
}
const controls: InputProps[] = []
let currentTable: ClientTable<Entry>
function captureTable(table: ClientTable<Entry>) {
    currentTable = table
}
const entries: Entry[] = [
    { id: '1', name: 'Alice', status: 'active', date: '2026-01-01' },
    { id: '2', name: 'Bob', status: 'inactive', date: '2026-02-01' },
]
const configs: TableColumnFilterConfigs = {
    name: { type: 'text', maxLength: 80 },
    status: { type: 'select', options: [{ value: 'active', label: 'Active' }] },
    date: { type: 'dateRange' },
}
function input(props: InputProps) {
    controls.push(props)
    return createElement('input', {
        placeholder: props.placeholder,
        value: typeof props.value === 'string' ? props.value : '',
        readOnly: true,
    })
}
vi.mock('@rentnerkev/inputs', () => ({ TextInput: input }))
vi.mock('@rentnerkev/select', () => ({ CustomSelect: input }))
vi.mock('@rentnerkev/calendar', () => ({ RangeCalendar: input }))
vi.mock('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({ children }: { children: ReactNode }) =>
        createElement(Fragment, null, children),
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'de',
        t: (key: string, values?: unknown) =>
            `${key}${values ? JSON.stringify(values) : ''}`,
    }),
}))

function Fixture({
    data = entries,
    body = {},
    filters = true,
    pageSize = 1,
}: {
    data?: Entry[]
    body?: Partial<TableBodyProps<Entry>>
    filters?: boolean
    pageSize?: number
}) {
    const { table } = useClientTable({
        data,
        columns: [
            { accessorKey: 'name', header: 'Name' },
            { accessorKey: 'status', header: 'Status' },
            { accessorKey: 'date', header: 'Date' },
            {
                id: 'actions',
                header: 'Actions',
                enableSorting: false,
                enableColumnFilter: false,
                cell: () => 'Edit',
            },
        ],
        getRowId: (row) => row.id,
        initialSorting: [],
    })
    captureTable(table)
    table.setPageSize(pageSize)
    return createElement(
        Fragment,
        null,
        createElement(TableSearchToolbar<Entry>, {
            table,
            value: '',
            placeholder: 'Search people',
            showColumnFilters: filters,
            onChange: vi.fn(),
            onToggleFilters: vi.fn(),
        }),
        createElement(
            'table',
            null,
            createElement(TableHead<Entry>, {
                table,
                showColumnFilters: filters,
                columnFilterConfigs: configs,
            }),
            createElement(TableBody<Entry>, { table, columnCount: 4, ...body }),
            createElement(TableFooter<Entry>, {
                table,
                columnCount: 4,
                itemLabel: 'people',
                pageSizeOptions: [
                    { value: 1, label: 'One' },
                    { value: 10, label: 'Ten' },
                ],
            }),
        ),
    )
}
beforeEach(() => {
    controls.length = 0
})

it('renders populated rows, sortable headers, accessible pagination and all filter types', () => {
    const html = renderToStaticMarkup(
        createElement(Fixture, {
            body: {
                rowClassName: (row) => `person-${row.id}`,
                cellClassName: (cell) => `field-${cell.column.id}`,
                renderExpandedRow: (row) =>
                    createElement(
                        'tr',
                        { key: `${row.id}-expanded` },
                        createElement('td', null, 'Extra details'),
                    ),
            },
        }),
    )
    expect(html).toContain('Alice')
    expect(html).not.toContain('Bob')
    expect(html).toContain('person-1')
    expect(html).toContain('field-name')
    expect(html).toContain('Extra details')
    expect(html).toContain('Search people')
    expect(html).toContain('shared.table.firstPage')
    expect(html).toContain('shared.table.toggleColumnFilters')
    expect(html).toContain('&quot;firstRowNumber&quot;:1')
    expect(
        controls.some((control) => control.placeholder === 'common.all'),
    ).toBe(true)
    expect(
        controls.some(
            (control) =>
                control.placeholder === 'shared.table.dateRangePlaceholder',
        ),
    ).toBe(true)
})

it('wires column controls and forwards calendar and page size changes to the table', () => {
    renderToStaticMarkup(createElement(Fixture))
    const text = controls.find(
        (control) => control.placeholder === 'shared.table.filterPlaceholder',
    )
    text?.onValueChange?.('Alice')
    expect(currentTable.getColumn('name')?.getFilterValue()).toBe('Alice')
    expect(
        currentTable.getRowModel().rows.map((row) => row.original.name),
    ).toEqual(['Alice'])
    controls
        .find((control) => control.placeholder === 'common.all')
        ?.onValueChange?.('inactive')
    expect(currentTable.getColumn('status')?.getFilterValue()).toBe('inactive')
    expect(currentTable.getRowModel().rows).toHaveLength(0)
    controls
        .find(
            (control) =>
                control.placeholder === 'shared.table.dateRangePlaceholder',
        )
        ?.onChange?.([new Date(2026, 0, 1), new Date(2026, 1, 1)])
    expect(currentTable.getColumn('date')?.getFilterValue()).toEqual({
        from: new Date(2026, 0, 1).toISOString(),
        to: new Date(2026, 1, 1).toISOString(),
    })
    currentTable.setPageIndex(1)
    controls
        .find((control) => control.placeholder === 'shared.table.amount')
        ?.onValueChange?.(10)
    expect(currentTable.atoms.pagination.get()).toEqual({
        pageSize: 10,
        pageIndex: 0,
    })
})

it.each([
    { body: { isLoading: true }, message: 'Lädt...' },
    { body: {}, message: 'Keine Einträge vorhanden' },
    { body: { searchInput: 'missing' }, message: 'Keine Ergebnisse gefunden' },
    {
        body: {
            emptyState: { title: 'Custom empty', description: 'Add a person' },
        },
        message: 'Custom empty',
    },
])(
    'renders distinct loading and empty table states: $message',
    ({ body, message }) => {
        const html = renderToStaticMarkup(
            createElement(Fixture, { data: [], body, filters: false }),
        )
        expect(html).toContain(message)
        expect(html).toContain('colSpan="4"')
        expect(html).toContain('&quot;firstRowNumber&quot;:0')
        expect(html).toContain('disabled=""')
        expect(html).not.toContain('shared.table.dateRangePlaceholder')
    },
)
