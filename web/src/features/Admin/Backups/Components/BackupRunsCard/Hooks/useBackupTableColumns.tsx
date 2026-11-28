import { useMemo } from 'react'
import { CustomTooltip } from '@rentnerkev/tooltips'
import { Download, RotateCcw, Trash2 } from 'lucide-react'
import type { TableColumn } from '@rentnerkev/table'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { BACKUP_ARCHIVE_EXTENSION } from '@/config/backup.config.ts'
import { formatDate } from '@/lib/Date/date.ts'
import { formatFileSize } from '@/lib/Format/format.ts'
import { authenticatedTableActionColumn } from '@/lib/Table/authenticatedTableStyles.ts'
import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import StatusIndicator from '@/shared/StatusIndicator.tsx'
import type { StatusIndicatorTone } from '@/shared/Types/status-indicator.types.ts'
import type { BackupRunStatus } from '@/lib/Backups/Types/backup.types.ts'
import type { BackupRun } from '../../../Types/backup-domain.types.ts'
import type { UseBackupTableColumnsParams } from '../Types/backup-table.types.ts'

const statusToneByBackupStatus: Record<BackupRunStatus, StatusIndicatorTone> = {
    queued: 'neutral',
    running: 'accent',
    completed: 'success',
    failed: 'danger',
}

export default function useBackupTableColumns({
    activeActionId,
    onOpenRestore,
    onDeleteBackup,
}: UseBackupTableColumnsParams): TableColumn<BackupRun>[] {
    const { t } = useTranslationStore()

    return useMemo(
        () => [
            {
                accessorKey: 'fileName',
                header: t('admin.backups.table.file'),
                enableHiding: false,
                meta: {
                    filter: {
                        type: 'text',
                        placeholder: t('admin.backups.table.file'),
                    },
                },
                size: 280,
                minSize: 260,
                cell: ({ row }) => (
                    <div className="min-w-0">
                        <p className="truncate font-medium text-white">
                            {row.original.fileName ??
                                t('admin.backups.preparing')}
                        </p>
                        {row.original.errorMessage && (
                            <CustomTooltip
                                content={
                                    <span className="block max-w-lg whitespace-normal break-all">
                                        {row.original.errorMessage}
                                    </span>
                                }
                                side="top"
                            >
                                <p
                                    className="mt-1 truncate text-xs text-red-300"
                                    tabIndex={0}
                                >
                                    {row.original.errorMessage}
                                </p>
                            </CustomTooltip>
                        )}
                    </div>
                ),
            },
            {
                accessorKey: 'startedAt',
                header: t('admin.backups.table.createdAt'),
                meta: {
                    filter: {
                        type: 'dateRange',
                        placeholder: t('admin.backups.table.createdAt'),
                    },
                },
                size: 210,
                minSize: 200,
                cell: ({ row }) => (
                    <span className="whitespace-nowrap text-secondary-text">
                        {formatDate(row.original.startedAt)}
                    </span>
                ),
            },
            {
                accessorKey: 'trigger',
                header: t('admin.backups.table.trigger'),
                meta: {
                    filter: {
                        type: 'select',
                        placeholder: t('admin.backups.table.trigger'),
                        options: (
                            [
                                'manual',
                                'scheduled',
                                'import',
                                'restore-safety',
                                'restore',
                            ] as const
                        ).map((value) => ({
                            value,
                            label: t(`admin.backups.trigger.${value}`),
                        })),
                    },
                },
                size: 180,
                minSize: 170,
                cell: ({ row }) => (
                    <span className="text-secondary-text">
                        {t(`admin.backups.trigger.${row.original.trigger}`)}
                    </span>
                ),
            },
            {
                accessorKey: 'fileSize',
                header: t('admin.backups.table.size'),
                size: 110,
                minSize: 100,
                enableColumnFilter: false,
                meta: { align: 'right' },
                cell: ({ row }) => (
                    <span className="block text-right font-mono text-secondary-text">
                        {row.original.fileSize === null
                            ? '—'
                            : formatFileSize(row.original.fileSize)}
                    </span>
                ),
            },
            {
                id: 'includesStorage',
                accessorFn: (backup) =>
                    backup.includesStorage ? 'included' : 'excluded',
                header: t('admin.backups.table.storage'),
                meta: {
                    filter: {
                        type: 'select',
                        placeholder: t('admin.backups.table.storage'),
                        options: [
                            { value: 'included', label: t('common.yes') },
                            { value: 'excluded', label: t('common.no') },
                        ],
                    },
                },
                size: 170,
                minSize: 160,
                cell: ({ row }) => (
                    <span className="text-secondary-text">
                        {row.original.includesStorage
                            ? t('common.yes')
                            : t('common.no')}
                    </span>
                ),
            },
            {
                accessorKey: 'status',
                header: t('common.status'),
                meta: {
                    filter: {
                        type: 'select',
                        placeholder: t('common.status'),
                        options: (
                            [
                                'queued',
                                'running',
                                'completed',
                                'failed',
                            ] as const
                        ).map((value) => ({
                            value,
                            label: t(`admin.backups.status.${value}`),
                        })),
                    },
                },
                size: 170,
                minSize: 160,
                cell: ({ row }) => (
                    <StatusIndicator
                        tone={statusToneByBackupStatus[row.original.status]}
                    >
                        {t(`admin.backups.status.${row.original.status}`)}
                    </StatusIndicator>
                ),
            },
            {
                ...authenticatedTableActionColumn,
                header: t('common.actions'),
                cell: ({ row }) => {
                    const backup = row.original
                    if (backup.status !== 'completed' || !backup.fileName)
                        return null

                    const supportsEncryptedArchive = backup.fileName.endsWith(
                        BACKUP_ARCHIVE_EXTENSION,
                    )
                    const unsupportedFormatMessage = supportsEncryptedArchive
                        ? undefined
                        : t('admin.backups.encryptedFormatRequired')
                    const isBusy = activeActionId === backup.id

                    return (
                        <ActionMenu
                            ariaLabel={`${t('common.openActions')} (${backup.fileName})`}
                            items={[
                                {
                                    id: 'download',
                                    label: t('admin.backups.download'),
                                    href: `/api/admin/backups/${encodeURIComponent(backup.id)}`,
                                    icon: <Download className="size-4" />,
                                    disabled: !supportsEncryptedArchive,
                                    description: unsupportedFormatMessage,
                                },
                                {
                                    id: 'restore',
                                    label: t('admin.backups.restore'),
                                    onSelect: () => onOpenRestore(backup.id),
                                    icon: <RotateCcw className="size-4" />,
                                    disabled:
                                        !supportsEncryptedArchive || isBusy,
                                    description: unsupportedFormatMessage,
                                },
                                {
                                    id: 'delete',
                                    label: t('admin.backups.delete'),
                                    onSelect: () => onDeleteBackup(backup.id),
                                    icon: <Trash2 className="size-4" />,
                                    disabled: isBusy,
                                    destructive: true,
                                },
                            ]}
                        />
                    )
                },
            },
        ],
        [activeActionId, onDeleteBackup, onOpenRestore, t],
    )
}
