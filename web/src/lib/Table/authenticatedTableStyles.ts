import type { DataTableClassNames } from '@rentnerkev/table'

const control = 'marketplace-table-control'
const iconControl = `${control} marketplace-table-icon-control`

export const authenticatedTableClassNames = {
    root: 'marketplace-table',
    toolbar: 'marketplace-table-toolbar',
    toolbarControls: 'marketplace-table-controls',
    title: 'marketplace-table-title',
    description: 'marketplace-table-description',
    table: 'marketplace-table-grid',
    header: 'marketplace-table-header',
    headerCell: 'marketplace-table-heading',
    row: 'marketplace-table-row',
    cell: 'marketplace-table-cell',
    footer: 'marketplace-table-footer',
    columnSettings: 'marketplace-signed-in marketplace-dialog-panel',
    button: control,
    filterButton: iconControl,
    filterBadge: 'marketplace-table-filter-count',
    columnVisibilityButton: iconControl,
    resetFiltersButton: iconControl,
    paginationButton: iconControl,
    sortButton: 'marketplace-table-sort',
    sortIcon: 'size-3.5',
} satisfies DataTableClassNames

export const authenticatedTableActionColumn = {
    id: 'actions',
    size: 80,
    minSize: 80,
    enableHiding: false,
    enableResizing: false,
    enableSorting: false,
    enableColumnFilter: false,
    meta: { align: 'right' },
} as const

export const authenticatedTableLayout = {
    columnWidthMode: 'scroll',
    // Escape the clipped table card while keeping overlays anchored.
    portalContainer: null,
    striped: false,
} as const
