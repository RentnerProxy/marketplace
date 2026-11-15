import { describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TableFooter from '@/shared/Table/TableFooter.tsx'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'

vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))

function TableFixture({ pageSize }: { pageSize: number }) {
    const { table } = useClientTable({
        data: [{ id: 'row-1' }],
        columns: [{ accessorKey: 'id', header: 'ID' }],
        getRowId: (row) => row.id,
        initialSorting: [],
    })
    table.setPageSize(pageSize)

    return createElement(
        'table',
        null,
        createElement(TableFooter<{ id: string }>, {
            table,
            columnCount: 1,
            itemLabel: 'entries',
            pageSizeOptions: [
                { value: 10, label: '10 entries' },
                { value: 20, label: '20 entries' },
                { value: 50, label: '50 entries' },
            ],
        }),
    )
}

describe('TableFooter mit nativen Select-Werten', function () {
    it.each([10, 20, 50])(
        'zeigt die numerische Seitengröße %s als ausgewählte Option',
        function (pageSize) {
            const html = renderToStaticMarkup(
                createElement(TableFixture, { pageSize }),
            )

            expect(html).toContain(`${pageSize} entries`)
            expect(html).toContain(`value="${pageSize}"`)
        },
    )
})
