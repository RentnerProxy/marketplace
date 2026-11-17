import { useMemo } from 'react'
import { CustomTooltip } from '@rentnerkev/tooltips'
import { Download, RotateCcw, Trash2 } from 'lucide-react'
import type { TableColumn } from '@rentnerkev/table'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { BACKUP_ARCHIVE_EXTENSION } from '@/config/backup.config.ts'
import { formatDate } from '@/lib/Date/date.ts'
import { formatFileSize } from '@/lib/Format/format.ts'
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
    const { t, language } = useTranslationStore()

    return useMemo(
        () => [
            {
                accessorKey: 'fileName',
                header: t('admin.backups.table.file', { lng: language }),
                enableHiding: false,
                meta: {
                    filter: {
                        type: 'text',
                        placeholder: t('admin.backups.table.file', { lng: language }),
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
                        options: ['manual', 'scheduled', 'import', 'restore-safety', 'restore'].map(
                            (value) => ({ value, label: t(`admin.backups.trigger.${value}`) }),
                        ),
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
                        options: ['queued', 'running', 'completed', 'failed'].map(
                            (value) => ({ value, label: t(`admin.backups.status.${value}`) }),
                        ),
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
                id: 'actions',
                header: t('common.actions'),
                size: 180,
                minSize: 180,
                enableSorting: false,
                enableColumnFilter: false,
                enableHiding: false,
                enableResizing: false,
                cell: ({ row }) => {
                    const backup = row.original
                    const canUseBackup =
                        backup.status === 'completed' &&
                        Boolean(backup.fileName)

                    if (!canUseBackup) return null
                    const supportsEncryptedArchive =
                        backup.fileName?.endsWith(BACKUP_ARCHIVE_EXTENSION) ===
                        true
                    const unsupportedFormatMessage = t(
                        'admin.backups.encryptedFormatRequired',
                    )

                    const actionClassName =
                        'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:border-primary/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

                    return (
                        <div className="flex justify-end gap-2">
                            <CustomTooltip
                                disabledTrigger={!supportsEncryptedArchive}
                                content={
                                    supportsEncryptedArchive
                                        ? t('admin.backups.download')
                                        : unsupportedFormatMessage
                                }
                            >
                                {supportsEncryptedArchive ? (
                                    <a
                                        href={`/api/admin/backups/${backup.id}`}
                                        aria-label={t('admin.backups.download')}
                                        className={actionClassName}
                                    >
                                        <Download className="h-4 w-4" />
                                    </a>
                                ) : (
                                    <button
                                        type="button"
                                        disabled
                                        aria-label={unsupportedFormatMessage}
                                        className={actionClassName}
                                    >
                                        <Download className="h-4 w-4" />
                                    </button>
                                )}
                            </CustomTooltip>
                            <CustomTooltip
                                disabledTrigger={
                                    !supportsEncryptedArchive ||
                                    activeActionId === backup.id
                                }
                                content={
                                    supportsEncryptedArchive
                                        ? t('admin.backups.restore')
                                        : unsupportedFormatMessage
                                }
                            >
                                <button
                                    type="button"
                                    onClick={() => onOpenRestore(backup.id)}
                                    disabled={
                                        !supportsEncryptedArchive ||
                                        activeActionId === backup.id
                                    }
                                    aria-label={t('admin.backups.restore')}
                                    className={actionClassName}
                                >
                                    <RotateCcw className="h-4 w-4" />
                                </button>
                            </CustomTooltip>
                            <CustomTooltip
                                content={t('admin.backups.delete')}
                                disabledTrigger={activeActionId === backup.id}
                            >
                                <button
                                    type="button"
                                    onClick={() => onDeleteBackup(backup.id)}
                                    disabled={activeActionId === backup.id}
                                    aria-label={t('admin.backups.delete')}
                                    className={actionClassName}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </CustomTooltip>
                        </div>
                    )
                },
            },
        ],
        [activeActionId, language, onDeleteBackup, onOpenRestore, t],
    )
}
