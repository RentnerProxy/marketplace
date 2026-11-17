import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import type { ReactElement } from 'react'
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
import type { DataTableProps, TableRow } from '@rentnerkev/table'

let tableProps: DataTableProps<AuditLogEntry>
let receiveEvent: (event: RealtimeEvent) => void
const unsubscribe = vi.fn()
const subscribe = vi.fn((listener: typeof receiveEvent) => {
    receiveEvent = listener
    return unsubscribe
})
let entries: Array<AuditLogEntry> | undefined
let loading = false
vi.mock('@/features/Admin/AuditLogs/middleware.ts', () => ({
    getAuditLogsHandler: vi.fn(),
}))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents: subscribe,
}))
vi.mock('@rentnerkev/table', () => ({
    DataTable(props: DataTableProps<AuditLogEntry>) {
        tableProps = props
        return createElement(
            'section',
            null,
            createElement('h2', null, props.title),
        )
    },
}))
import AuditLogs from '@/features/Admin/AuditLogs/index.tsx'
import useAuditLogic from '@/features/Admin/AuditLogs/Hooks/useAuditLogic.ts'
import useAuditLogDetailsLogic from '@/features/Admin/AuditLogs/Components/AuditTable/Hooks/useAuditLogDetailsLogic.ts'
import { AuditLogDetails } from '@/features/Admin/AuditLogs/Components/AuditTable/Components/AuditLogDetails.tsx'

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
const secondEntry = { ...entry, id: 'audit-3', method: 'GET' }

function renderAuditLogs() {
    return renderToStaticMarkup(render(AuditLogs))
}

function tableRow(original: AuditLogEntry): TableRow<AuditLogEntry> {
    return { id: original.id, original } as TableRow<AuditLogEntry>
}

function cell(
    index: number,
    original = entry,
): ReactElement<Record<string, unknown>> {
    const renderCell = tableProps.columns[index]?.cell as (input: {
        row: { original: AuditLogEntry }
    }) => ReactElement<Record<string, unknown>>
    return renderCell({ row: { original } })
}

beforeEach(() => {
    reset()
    entries = [entry, systemEntry, secondEntry]
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
    it('configures audit sorting, pagination, and localized filters', () => {
        renderAuditLogs()
        expect(tableProps.getRowId(entry, 0)).toBe(entry.id)
        expect(tableProps.tableOptions?.initialState?.sorting).toEqual([
            { id: 'createdAt', desc: true },
        ])
        expect(tableProps.pageSizeOptions).toEqual([10, 20, 50, 100])
        expect(tableProps.searchPlaceholder).toBe(
            'admin.auditLogs.searchPlaceholder',
        )
        expect(tableProps.columnSettings).toBe(true)
        expect(tableProps.resizableColumns).toBe(true)
        expect(tableProps.columns[0]?.enableHiding).toBe(false)
        expect(tableProps.columns[1]?.enableHiding).toBe(false)
        expect(tableProps.columns[0]?.meta?.filter).toMatchObject({
            type: 'select',
            options: [
                { value: 'session.created', label: 'session.created' },
                { value: 'user.updated', label: 'user.updated' },
            ],
        })
        expect(tableProps.columns[3]?.meta?.filter).toMatchObject({
            type: 'select',
            options: [
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
            ],
        })
        expect(tableProps.columns[1]?.meta?.filter).toEqual({
            type: 'text',
            placeholder: 'admin.auditLogs.userFilterPlaceholder',
        })
        expect(tableProps.columns[5]?.meta?.filter).toEqual({
            type: 'dateRange',
            placeholder: 'admin.auditLogs.createdFilterPlaceholder',
        })
    })

    it('renders populated and system fallback cells and uses system as a filterable actor value', () => {
        renderAuditLogs()
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
        const actorColumn = tableProps.columns[1]
        if (
            !actorColumn ||
            !('accessorFn' in actorColumn) ||
            !actorColumn.accessorFn
        )
            throw new Error('Missing actor filter accessor')
        expect(actorColumn.accessorFn(entry, 0)).toBe('Ada')
        expect(actorColumn.accessorFn(systemEntry, 0)).toBe('system')
    })

    it('allows one eligible audit row to be expanded at a time', () => {
        renderAuditLogs()
        const { getRowCanExpand, onExpandedChange } =
            tableProps.tableOptions ?? {}
        if (!getRowCanExpand || !onExpandedChange)
            throw new Error('Missing audit expansion options')
        expect(getRowCanExpand(tableRow(entry))).toBe(true)
        expect(getRowCanExpand(tableRow(systemEntry))).toBe(false)
        expect(tableProps.messages?.expandRow?.('')).toBe(
            'admin.auditLogs.details',
        )
        expect(tableProps.getRowLabel?.(entry)).not.toBe(
            tableProps.getRowLabel?.(secondEntry),
        )
        onExpandedChange({ [entry.id]: true })
        renderAuditLogs()
        expect(tableProps.tableOptions?.state?.expanded).toEqual({
            [entry.id]: true,
        })
        onExpandedChange((current) => ({
            ...(current === true ? {} : current),
            [secondEntry.id]: true,
        }))
        renderAuditLogs()
        expect(tableProps.tableOptions?.state?.expanded).toEqual({
            [secondEntry.id]: true,
        })
        onExpandedChange({})
        renderAuditLogs()
        expect(tableProps.tableOptions?.state?.expanded).toEqual({})
    })

    it('formats changed values only and renders the before/after diff and empty state', () => {
        const hook = render(() => useAuditLogDetailsLogic(entry))
        expect(hook.state.rows).toEqual([
            { key: 'username', oldValue: 'Old', newValue: 'New' },
        ])
        const html = renderToStaticMarkup(AuditLogDetails({ auditLog: entry }))
        expect(html).toStartWith('<div')
        expect(html).toContain('Old')
        expect(html).toContain('New')
        expect(html).not.toContain('unchanged')
        const empty = renderToStaticMarkup(
            AuditLogDetails({ auditLog: systemEntry }),
        )
        expect(empty).toContain('admin.auditLogs.emptyDiff')
    })

    it('forwards loading status and renders the diff for the requested row', () => {
        loading = true
        const html = renderAuditLogs()
        expect(html).toContain('admin.auditLogs.entriesTitle')
        expect(tableProps.isLoading).toBe(true)
        expect(tableProps.data).toEqual([entry, systemEntry, secondEntry])
        const diff = renderToStaticMarkup(
            tableProps.renderExpandedRow?.(tableRow(entry)),
        )
        expect(diff).toContain('Old')
        expect(diff).toContain('New')
    })
})
