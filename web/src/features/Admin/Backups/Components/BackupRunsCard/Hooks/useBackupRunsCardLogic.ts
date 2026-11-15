import { useEffect, useMemo, useState } from 'react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { formatCountdown } from '@/lib/Date/date.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import useBackupTableColumns from './useBackupTableColumns.tsx'
import type { BackupRun } from '../../../Types/backup-domain.types.ts'
import type {
    UseBackupRunsCardLogicParams,
    BackupRunsCardLogicReturn,
} from '../Types/backup-table.types.ts'

const getBackupRunRowId = (backupRun: BackupRun) => backupRun.id

export default function useBackupRunsCardLogic({
    runs,
    nextBackupAt,
    activeActionId,
    onOpenRestore,
    onDeleteBackup,
}: UseBackupRunsCardLogicParams): BackupRunsCardLogicReturn {
    const { language, t } = useTranslationStore()
    const [now, setNow] = useState(() => Date.now())
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useBackupTableColumns({
        activeActionId,
        onOpenRestore,
        onDeleteBackup,
    })
    const tableLogic = useClientTable({
        data: runs,
        columns,
        getRowId: getBackupRunRowId,
        initialSorting: [{ id: 'startedAt', desc: true }],
    })

    useEffect(() => {
        if (!nextBackupAt) return undefined
        const interval = window.setInterval(() => setNow(Date.now()), 1_000)

        return () => window.clearInterval(interval)
    }, [nextBackupAt])

    const nextBackupIn = nextBackupAt
        ? formatCountdown(Math.max(0, new Date(nextBackupAt).getTime() - now))
        : null
    const pageSizeOptions = useMemo(
        () =>
            [10, 20, 50, 100].map((count) => ({
                value: count,
                label: t('admin.backups.table.entryCount', {
                    count,
                    lng: language,
                }),
            })),
        [language, t],
    )
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            fileName: {
                type: 'text',
                placeholder: t('admin.backups.table.file', {
                    lng: language,
                }),
            },
            startedAt: {
                type: 'dateRange',
                placeholder: t('admin.backups.table.createdAt'),
            },
            trigger: {
                type: 'select',
                placeholder: t('admin.backups.table.trigger'),
                options: [
                    'manual',
                    'scheduled',
                    'import',
                    'restore-safety',
                    'restore',
                ].map((value) => ({
                    value,
                    label: t(`admin.backups.trigger.${value}`),
                })),
            },
            includesStorage: {
                type: 'select',
                placeholder: t('admin.backups.table.storage'),
                options: [
                    { value: 'included', label: t('common.yes') },
                    { value: 'excluded', label: t('common.no') },
                ],
            },
            status: {
                type: 'select',
                placeholder: t('common.status'),
                options: ['queued', 'running', 'completed', 'failed'].map(
                    (value) => ({
                        value,
                        label: t(`admin.backups.status.${value}`),
                    }),
                ),
            },
        }),
        [language, t],
    )

    function handleToggleColumnFilters() {
        setShowColumnFilters((current) => !current)
    }

    return {
        table: tableLogic.table,
        state: {
            searchInput: tableLogic.state.searchInput,
            showColumnFilters,
            nextBackupIn,
            pageSizeOptions,
            columnFilterConfigs,
            columnCount: columns.length,
        },
        handler: {
            handleSearchInputChange: tableLogic.handler.handleSearchInputChange,
            handleToggleColumnFilters,
        },
    }
}
