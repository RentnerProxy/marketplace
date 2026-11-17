import { Clock3, History } from 'lucide-react'
import { DataTable } from '@rentnerkev/table'
import { TABLE_LOCALES } from '@/config/language-library.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { getMarketplaceTableMessages } from '@/lib/Table/tableMessages.ts'
import BackupRestorePanel from '../BackupRestorePanel.tsx'
import BackupStatBadge from '../BackupStatBadge.tsx'
import useBackupCountdown from './Hooks/useBackupCountdown.ts'
import useBackupTableColumns from './Hooks/useBackupTableColumns.tsx'
import type { BackupRun } from '../../Types/backup-domain.types.ts'
import type { BackupRunsCardProps } from './Types/backup-table.types.ts'

const pageSizeOptions = [10, 20, 50, 100]
const getBackupRunRowId = (backupRun: BackupRun) => backupRun.id

export default function BackupRunsCard({
    state: backupState,
    handler: backupHandler,
}: BackupRunsCardProps) {
    const { language, t } = useTranslationStore()
    const { activeActionId, restoreBackupId, isLoading } = backupState
    const nextBackupIn = useBackupCountdown(backupState.nextBackupAt)
    const columns = useBackupTableColumns({
        activeActionId,
        onOpenRestore: backupHandler.handleOpenRestore,
        onDeleteBackup: backupHandler.handleDeleteBackup,
    })
    const expanded = restoreBackupId ? { [restoreBackupId]: true } : {}

    return (
        <DataTable<BackupRun>
            locale={TABLE_LOCALES[language]}
            messages={getMarketplaceTableMessages(t, t('admin.backups.table.itemLabel'))}
            title={t('admin.backups.historyTitle')}
            icon={<History size={20} />}
            description={
                backupState.isAutomaticBackupEnabled && (
                    <span className="flex items-center gap-2">
                        <Clock3 size={14} className="text-primary" aria-hidden />
                        {nextBackupIn
                            ? t('admin.backups.nextBackupIn', { time: nextBackupIn })
                            : t('admin.backups.nextBackupCalculating')}
                    </span>
                )
            }
            className="[&_[data-table-slot=expandButton]:disabled[aria-expanded=false]]:invisible"
            classNames={{
                table: 'min-w-[1270px]',
                toolbarControls: 'flex flex-wrap items-center gap-2 lg:justify-end',
            }}
            toolbarActions={
                <div className="-order-1 flex basis-full flex-wrap gap-2 lg:justify-end">
                    <BackupStatBadge
                        label={t('admin.backups.stats.total')}
                        value={backupState.stats.total}
                        className="border-border-dark bg-input-dark text-white"
                    />
                    <BackupStatBadge
                        label={t('admin.backups.stats.successful')}
                        value={backupState.stats.successful}
                        className="border-border-dark bg-input-dark text-secondary-text"
                    />
                    <BackupStatBadge
                        label={t('admin.backups.stats.failed')}
                        value={backupState.stats.failed}
                        className="border-border-dark bg-input-dark text-secondary-text"
                    />
                    <BackupStatBadge
                        label={t('admin.backups.stats.imported')}
                        value={backupState.stats.imported}
                        className="border-border-dark bg-input-dark text-secondary-text"
                    />
                    <BackupStatBadge
                        label={t('admin.backups.stats.restored')}
                        value={backupState.stats.restored}
                        className="border-border-dark bg-input-dark text-secondary-text"
                    />
                </div>
            }
            data={backupState.runs}
            columns={columns}
            getRowId={getBackupRunRowId}
            getRowLabel={(run) => run.fileName ?? run.id}
            tableOptions={{
                initialState: { sorting: [{ id: 'startedAt', desc: true }] },
                autoResetExpanded: false,
                state: { expanded },
                getRowCanExpand: (row) =>
                    row.id === restoreBackupId && row.id !== activeActionId,
                onExpandedChange: (updater) => {
                    if (isLoading || !restoreBackupId || restoreBackupId === activeActionId) return

                    // Only the restore action selects a backup. The table may cancel that selection.
                    const nextExpanded =
                        typeof updater === 'function' ? updater(expanded) : updater
                    if (nextExpanded !== true && !nextExpanded[restoreBackupId]) {
                        backupHandler.handleCancelRestore()
                    }
                },
            }}
            columnSettings
            resizableColumns
            pageSizeOptions={pageSizeOptions}
            searchPlaceholder={t('admin.backups.table.searchPlaceholder')}
            isLoading={isLoading}
            loadingState={t('admin.backups.loading')}
            emptyState={t('admin.backups.empty')}
            renderExpandedRow={(row) => (
                <BackupRestorePanel
                    backupId={row.original.id}
                    state={backupState}
                    handler={backupHandler}
                />
            )}
        />
    )
}
