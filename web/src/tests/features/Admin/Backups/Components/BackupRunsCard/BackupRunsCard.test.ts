import { describe, expect, it, mock } from 'bun:test'
import { createElement, Fragment, isValidElement } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { DataTable, useDataTableLogic } from '@rentnerkev/table'
import type { DataTableLogicResult, DataTableProps } from '@rentnerkev/table'
import { renderToStaticMarkup } from 'react-dom/server'
import BackupRunsCard from '@/features/Admin/Backups/Components/BackupRunsCard/index.tsx'
import type { BackupRun } from '@/features/Admin/Backups/Types/backup-domain.types.ts'
import type { BackupRunsCardProps } from '@/features/Admin/Backups/Components/BackupRunsCard/Types/backup-table.types.ts'
import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import RowDetailsDialog from '@/shared/Table/RowDetailsDialog.tsx'
import { completedRun } from '../backupFixtures.ts'
import { findElement } from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'de',
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))

function props(): BackupRunsCardProps {
    return {
        state: {
            runs: [completedRun],
            stats: {
                total: 4,
                successful: 1,
                failed: 1,
                imported: 1,
                restored: 1,
            },
            nextBackupAt: null,
            restoreBackupId: null,
            restoreConfirmation: '',
            isLoading: false,
            activeActionId: null,
            isAutomaticBackupEnabled: true,
        },
        handler: {
            handleDeleteBackup: mock(),
            handleOpenRestore: mock(),
            handleCancelRestore: mock(),
            handleRestoreConfirmationChange: mock(),
            handleRestoreBackup: mock(),
        },
    }
}

function capture(fixture: BackupRunsCardProps) {
    let logic: DataTableLogicResult<BackupRun> | undefined
    function Capture() {
        const table = findElement(
            BackupRunsCard(fixture),
            (element) => element.type === DataTable,
        )
        if (!isValidElement<DataTableProps<BackupRun>>(table))
            throw new Error('Missing backup table options')
        logic = useDataTableLogic(table.props)
        return null
    }
    renderToStaticMarkup(createElement(Capture))
    if (!logic) throw new Error('Missing backup table logic')
    return logic
}

function actionCell(logic: DataTableLogicResult<BackupRun>): ReactNode {
    const cell = logic.table
        .getRowModel()
        .rows[0]!.getAllCells()
        .find((candidate) => candidate.column.id === 'actions')!
    const renderer = cell.column.columnDef.cell
    if (typeof renderer !== 'function')
        throw new Error('Missing backup action renderer')
    return renderer(cell.getContext())
}

function actionItems(logic: DataTableLogicResult<BackupRun>) {
    const tree = actionCell(logic)
    if (
        !isValidElement<ComponentProps<typeof ActionMenu>>(tree) ||
        tree.type !== ActionMenu
    )
        throw new Error('Missing backup action menu')
    return tree.props.items
}

describe('Backup runs card', () => {
    it('renders loading, empty and scheduled countdown states', () => {
        const fixture = props()
        fixture.state.isLoading = true
        expect(
            renderToStaticMarkup(createElement(BackupRunsCard, fixture)),
        ).toContain('admin.backups.loading')
        fixture.state.isLoading = false
        fixture.state.runs = []
        let html = renderToStaticMarkup(createElement(BackupRunsCard, fixture))
        expect(html).toContain('admin.backups.empty')
        expect(html).toContain('admin.backups.nextBackupCalculating')
        fixture.state.nextBackupAt = new Date(Date.now() + 60000).toISOString()
        html = renderToStaticMarkup(createElement(BackupRunsCard, fixture))
        expect(html).toContain('admin.backups.nextBackupIn')
        fixture.state.isAutomaticBackupEnabled = false
        expect(
            renderToStaticMarkup(createElement(BackupRunsCard, fixture)),
        ).not.toContain('admin.backups.nextBackupIn')
    })

    it('renders run status, archive size, trigger, storage and failure details', () => {
        const fixture = props()
        fixture.state.runs = [
            completedRun,
            {
                ...completedRun,
                id: 'failed',
                status: 'failed',
                fileName: null,
                fileSize: null,
                includesStorage: false,
                trigger: 'scheduled',
                errorMessage: 'Archive verification failed',
            },
        ]
        const html = renderToStaticMarkup(
            createElement(BackupRunsCard, fixture),
        )
        for (const text of [
            'archive.enc',
            '2.0 KB',
            'admin.backups.trigger.manual',
            'admin.backups.trigger.scheduled',
            'common.yes',
            'common.no',
            'admin.backups.status.completed',
            'admin.backups.status.failed',
            'Archive verification failed',
            'admin.backups.preparing',
            'admin.backups.stats.imported',
            'admin.backups.stats.restored',
        ])
            expect(html).toContain(text)
        expect(html).toContain('tabindex="0"')
    })

    it('uses backup IDs for rows and exposes filter choices, page sizes and guarded actions', () => {
        const fixture = props()
        const logic = capture(fixture)
        expect(logic.table.getRowModel().rows[0]!.id).toBe(completedRun.id)
        expect(
            logic.table.getRowModel().rows[0]!.getValue('includesStorage'),
        ).toBe('included')
        expect(logic.state.pageSizes).toEqual(
            [10, 20, 50, 100].map((value) => ({
                value,
                label: `admin.backups.table.entryCount{"count":${value}}`,
            })),
        )
        expect(logic.table.state.sorting).toEqual([
            { id: 'startedAt', desc: true },
        ])
        expect(
            logic.table.getColumn('trigger')?.columnDef.meta?.filter,
        ).toMatchObject({
            type: 'select',
        })
        expect(
            logic.table.getColumn('startedAt')?.columnDef.meta?.filter,
        ).toMatchObject({
            type: 'dateRange',
        })
        expect(logic.table.getColumn('actions')?.getCanHide()).toBe(false)
        const [download, restore, remove] = actionItems(logic)
        expect(download).toMatchObject({ href: '/api/admin/backups/backup-1' })
        expect(restore).toMatchObject({ disabled: false })
        expect(remove).toMatchObject({ destructive: true, disabled: false })
        restore?.onSelect?.()
        remove?.onSelect?.()
        expect(fixture.handler.handleOpenRestore).toHaveBeenCalledWith(
            completedRun.id,
        )
        expect(fixture.handler.handleDeleteBackup).toHaveBeenCalledWith(
            completedRun.id,
        )
        fixture.state.activeActionId = completedRun.id
        expect(
            actionItems(capture(fixture)).map(({ disabled }) => disabled),
        ).toEqual([false, true, true])
        fixture.state.runs = [{ ...completedRun, fileName: 'legacy.tar' }]
        expect(actionItems(capture(fixture))[0]?.disabled).toBe(true)
        fixture.state.runs = [{ ...completedRun, status: 'queued' }]
        expect(actionCell(capture(fixture))).toBeNull()
        fixture.state.runs = [{ ...completedRun, includesStorage: false }]
        expect(
            capture(fixture)
                .table.getRowModel()
                .rows[0]!.getValue('includesStorage'),
        ).toBe('excluded')
    })

    it('opens restore confirmation outside the table, where it remains available across pages', () => {
        const fixture = props()
        const secondRun = { ...completedRun, id: 'backup-2' }
        fixture.state.runs = [completedRun, secondRun]
        const idleHtml = renderToStaticMarkup(
            createElement(BackupRunsCard, fixture),
        )
        expect(idleHtml).not.toContain('admin.backups.restoreConfirm')

        fixture.state.restoreBackupId = completedRun.id
        fixture.state.runs = [secondRun]
        function Capture() {
            const body = BackupRunsCard(fixture)
            const dialog = findElement(
                body,
                (element) => element.type === RowDetailsDialog,
            )
            expect(dialog.props.closeDisabled).toBe(
                fixture.state.activeActionId === completedRun.id,
            )
            expect(dialog.props.onClose).toBe(
                fixture.handler.handleCancelRestore,
            )
            expect(dialog.props.footer).toBeDefined()
            return createElement(
                Fragment,
                null,
                dialog.props.children,
                dialog.props.footer as ReactNode,
            )
        }
        const dialogHtml = renderToStaticMarkup(createElement(Capture))
        expect(dialogHtml).toContain('common.cancel')
        expect(dialogHtml).toContain('admin.backups.restoreConfirm')
        expect(dialogHtml).toContain('admin.backups.restoreWarning')
        expect(dialogHtml).toContain(`restore-warning-${completedRun.id}`)
        expect(dialogHtml).not.toContain(`restore-warning-${secondRun.id}`)

        fixture.state.activeActionId = completedRun.id
        const busyHtml = renderToStaticMarkup(createElement(Capture))
        expect(busyHtml.match(/disabled=""/g)).toHaveLength(3)
        const html = renderToStaticMarkup(
            createElement(BackupRunsCard, fixture),
        )
        expect(html).not.toContain('data-row-details-for=')
        expect(html).not.toContain('data-table-slot="expandButton"')
    })

    it('applies text, select and local calendar date filters to backup runs', () => {
        const fixture = props()
        fixture.state.runs = [
            {
                ...completedRun,
                startedAt: new Date(2030, 0, 2, 23, 59).toISOString(),
            },
            {
                ...completedRun,
                id: 'earlier',
                startedAt: new Date(2030, 0, 1).toISOString(),
            },
            { ...completedRun, id: 'scheduled', trigger: 'scheduled' },
        ]
        const { table, handler } = capture(fixture)
        const rowIds = () => table.getRowModel().rows.map((row) => row.id)

        handler.handleSearch('ARCHIVE')
        expect(rowIds()).toHaveLength(3)
        handler.handleSearch('unknown backup')
        expect(rowIds()).toEqual([])
        handler.handleSearch('')

        table.getColumn('fileName')?.setFilterValue('archive')
        table.getColumn('trigger')?.setFilterValue('manual')
        expect(rowIds()).toEqual([completedRun.id, 'earlier'])
        table
            .getColumn('startedAt')
            ?.setFilterValue({ from: '2030-01-02', to: '2030-01-02' })
        expect(rowIds()).toEqual([completedRun.id])
    })
})
