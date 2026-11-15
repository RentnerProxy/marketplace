import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    cleanup,
    client,
    query,
    render,
    reset,
} from '../UserManagement/user-management-hooks.test.helpers.ts'
import type { AuditLogEntry } from '@/lib/AuditLogs/Types/auditLog.types.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import type { ColumnDef } from '@tanstack/react-table'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'

type TableOptions = {
    data: Array<AuditLogEntry>
    columns: Array<ColumnDef<ClientTableFeatures, AuditLogEntry>>
    getRowId: (entry: AuditLogEntry) => string
    initialSorting: Array<{ id: string; desc: boolean }>
}
let tableOptions: TableOptions
let receiveEvent: (event: RealtimeEvent) => void
const unsubscribe = vi.fn()
const subscribe = vi.fn((listener: typeof receiveEvent) => {
    receiveEvent = listener
    return unsubscribe
})
const search = vi.fn()
let entries: Array<AuditLogEntry> | undefined
let loading = false
let bodyLoading = false
vi.mock('@/features/Admin/AuditLogs/middleware.ts', () => ({
    getAuditLogsHandler: vi.fn(),
}))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents: subscribe,
}))
vi.mock('@/shared/Table/Hooks/useClientTable.ts', () => ({
    default(options: TableOptions) {
        tableOptions = options
        return {
            table: {},
            state: { searchInput: '' },
            handler: { handleSearchInputChange: search },
        }
    },
}))
vi.mock('@/shared/Table/TableHead.tsx', () => ({
    default: () => createElement('thead'),
}))
vi.mock('@/shared/Table/TableFooter.tsx', () => ({
    default: () => createElement('tfoot'),
}))
vi.mock('@/shared/Table/TableSearchToolbar.tsx', () => ({
    default: () => null,
}))
vi.mock('@/shared/Table/TableBody.tsx', () => ({
    default({
        renderExpandedRow,
        isLoading,
    }: {
        renderExpandedRow: (row: { original: AuditLogEntry }) => ReactNode
        isLoading: boolean
    }) {
        bodyLoading = isLoading
        return createElement(
            'tbody',
            {},
            ...tableOptions.data.map((original) =>
                renderExpandedRow({ original }),
            ),
        )
    },
}))
import AuditLogs from '@/features/Admin/AuditLogs/index.tsx'
import useAuditLogic from '@/features/Admin/AuditLogs/Hooks/useAuditLogic.ts'
import useAuditTableLogic from '@/features/Admin/AuditLogs/Components/AuditTable/Hooks/useAuditTableLogic.ts'
import useAuditLogDetailsLogic from '@/features/Admin/AuditLogs/Components/AuditTable/Hooks/useAuditLogDetailsLogic.ts'
import { AuditLogDetailsRow } from '@/features/Admin/AuditLogs/Components/AuditTable/Components/AuditLogDetailsRow.tsx'

const entry: AuditLogEntry = {
    id: 'audit-1',
    action: 'user.updated',
    actorUserId: 'actor-1',
    actorUsername: 'Ada',
    message: 'User changed',
    route: '/admin/users',
    method: 'POST',
    createdAt: '2026-01-01T00:00:00Z',
    oldValues: { username: 'Old', unchanged: true },
    newValues: { username: 'New', unchanged: true },
}
const systemEntry: AuditLogEntry = {
    ...entry,
    id: 'audit-2',
    action: 'session.created',
    actorUserId: null,
    actorUsername: null,
    message: null,
    route: null,
    method: null,
    oldValues: null,
    newValues: null,
}
const useTable = () =>
    useAuditTableLogic({
        auditLogs: entries ?? [],
        isLoadingAuditLogs: loading,
    })

function cell(
    index: number,
    original = entry,
): ReactElement<Record<string, unknown>> {
    const renderCell = tableOptions.columns[index]?.cell as (input: {
        row: { original: AuditLogEntry }
    }) => ReactElement<Record<string, unknown>>
    return renderCell({ row: { original } })
}

beforeEach(() => {
    reset()
    entries = [entry, systemEntry, { ...entry, id: 'audit-3', method: 'GET' }]
    loading = false
    query.mockImplementation(() => ({ data: entries, isLoading: loading }))
})

describe('audit log query and realtime', () => {
    it('uses an empty loading state and exposes fetched entries', () => {
        entries = undefined
        loading = true
        let hook = render(useAuditLogic)
        expect(hook.state.auditLogs).toEqual([])
        expect(hook.state.isLoadingAuditLogs).toBe(true)
        entries = [entry]
        loading = false
        hook = render(useAuditLogic)
        expect(hook.state.auditLogs).toEqual([entry])
        expect(hook.state.isLoadingAuditLogs).toBe(false)
        expect(query).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: ['admin-audit-logs'] }),
        )
    })

    it('refetches the exact audit log query only for audit events and unsubscribes on cleanup', () => {
        const refetch = vi.spyOn(client, 'refetchQueries')
        render(useAuditLogic)
        render(useAuditLogic)
        expect(subscribe).toHaveBeenCalledTimes(1)
        receiveEvent({
            type: 'admin-permissions.updated',
            payload: {},
        } as RealtimeEvent)
        expect(refetch).not.toHaveBeenCalled()
        receiveEvent({
            type: 'audit-log.created',
            payload: {},
        } as RealtimeEvent)
        expect(refetch).toHaveBeenCalledWith({
            queryKey: ['admin-audit-logs'],
            exact: true,
        })
        cleanup()
        expect(unsubscribe).toHaveBeenCalledTimes(1)
        refetch.mockRestore()
    })
})

describe('audit table behavior', () => {
    it('builds sorted unique filters, forwards search and toggles column filtering', () => {
        let hook = render(useTable)
        expect(tableOptions.getRowId(entry)).toBe(entry.id)
        expect(tableOptions.initialSorting).toEqual([
            { id: 'createdAt', desc: true },
        ])
        expect(hook.state.columnFilterConfigs.action).toMatchObject({
            options: [
                { value: 'session.created', label: 'session.created' },
                { value: 'user.updated', label: 'user.updated' },
            ],
        })
        expect(hook.state.columnFilterConfigs.method).toMatchObject({
            options: [
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
            ],
        })
        expect(hook.state.showColumnFilters).toBe(false)
        hook.handler.handleToggleColumnFilters()
        hook = render(useTable)
        expect(hook.state.showColumnFilters).toBe(true)
        hook.handler.handleSearchInputChange('Ada')
        expect(search).toHaveBeenCalledWith('Ada')
    })

    it('renders populated and system fallback cells and uses system as a filterable actor value', () => {
        render(useTable)
        expect(renderToStaticMarkup(cell(0))).toContain('user.updated')
        expect(renderToStaticMarkup(cell(1))).toContain('Ada')
        expect(renderToStaticMarkup(cell(1))).toContain('actor-1')
        expect(renderToStaticMarkup(cell(1, systemEntry))).toContain(
            'admin.auditLogs.system',
        )
        expect(renderToStaticMarkup(cell(2))).toContain('User changed')
        expect(renderToStaticMarkup(cell(3))).toContain('POST')
        expect(renderToStaticMarkup(cell(4))).toContain('/admin/users')
        expect(renderToStaticMarkup(cell(5))).toContain('2026')
        for (const index of [2, 3, 4])
            expect(renderToStaticMarkup(cell(index, systemEntry))).toContain(
                '-',
            )
        const actorColumn = tableOptions.columns[1]
        if (
            !actorColumn ||
            !('accessorFn' in actorColumn) ||
            !actorColumn.accessorFn
        )
            throw new Error('Missing actor filter accessor')
        expect(actorColumn.accessorFn(entry, 0)).toBe('Ada')
        expect(actorColumn.accessorFn(systemEntry, 0)).toBe('system')
    })

    it('expands and collapses details, disabling detail actions for empty records', () => {
        render(useTable)
        let details = cell(6)
        expect(details.props.disabled).toBe(false)
        const expand = details.props.onClick
        if (typeof expand !== 'function')
            throw new Error('Missing expand action')
        expand()
        expect(render(useTable).state.expandedAuditLogId).toBe(entry.id)
        details = cell(6)
        const collapse = details.props.onClick
        if (typeof collapse !== 'function')
            throw new Error('Missing collapse action')
        collapse()
        expect(render(useTable).state.expandedAuditLogId).toBeNull()
        expect(cell(6, systemEntry).props.disabled).toBe(true)
    })

    it('formats changed values only and renders the before/after diff and empty state', () => {
        const hook = render(() => useAuditLogDetailsLogic(entry))
        expect(hook.state.rows).toEqual([
            { key: 'username', oldValue: 'Old', newValue: 'New' },
        ])
        const html = renderToStaticMarkup(
            AuditLogDetailsRow({ auditLog: entry, columnCount: 7 }),
        )
        expect(html).toContain('colSpan="7"')
        expect(html).toContain('Old')
        expect(html).toContain('New')
        expect(html).not.toContain('unchanged')
        const empty = renderToStaticMarkup(
            AuditLogDetailsRow({ auditLog: systemEntry, columnCount: 7 }),
        )
        expect(empty).toContain('admin.auditLogs.emptyDiff')
    })

    it('renders the screen with loading status and expands the requested row through the table body callback', () => {
        loading = true
        let html = renderToStaticMarkup(render(AuditLogs))
        expect(html).toContain('admin.auditLogs.entriesTitle')
        expect(bodyLoading).toBe(true)
        expect(html).not.toContain('Old')
        const expand = cell(6).props.onClick
        if (typeof expand !== 'function')
            throw new Error('Missing expand action')
        expand()
        html = renderToStaticMarkup(render(AuditLogs))
        expect(html).toContain('Old')
        expect(html).toContain('New')
    })
})
