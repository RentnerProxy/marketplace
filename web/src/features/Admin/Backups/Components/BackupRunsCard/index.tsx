import { Clock3, History } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import TableBody from '@/shared/Table/TableBody.tsx'
import TableFooter from '@/shared/Table/TableFooter.tsx'
import TableHead from '@/shared/Table/TableHead.tsx'
import TableSearchToolbar from '@/shared/Table/TableSearchToolbar.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import BackupRestoreRow from '../BackupRestoreRow.tsx'
import BackupStatBadge from '../BackupStatBadge.tsx'
import useBackupRunsCardLogic from './Hooks/useBackupRunsCardLogic.ts'
import type { BackupRunsCardProps } from './Types/backup-table.types.ts'

export default function BackupRunsCard({
    state: backupState,
    handler: backupHandler,
}: BackupRunsCardProps) {
    const { t } = useTranslationStore()
    const { state, handler, table } = useBackupRunsCardLogic({
        runs: backupState.runs,
        nextBackupAt: backupState.nextBackupAt,
        activeActionId: backupState.activeActionId,
        onOpenRestore: backupHandler.handleOpenRestore,
        onDeleteBackup: backupHandler.handleDeleteBackup,
    })

    return (
        <section className="overflow-hidden rounded-xl border border-border-dark bg-surface-dark">
            <div className="flex flex-col gap-4 border-b border-border-dark px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-start gap-3">
                    <HeadingIcon icon={History} />
                    <div>
                        <h2 className="text-lg font-bold text-white">
                            {t('admin.backups.historyTitle')}
                        </h2>
                        {backupState.isAutomaticBackupEnabled && (
                            <div className="mt-1 flex items-center gap-2 text-xs text-secondary-text">
                                <Clock3 size={14} className="text-primary" />
                                {state.nextBackupIn
                                    ? t('admin.backups.nextBackupIn', {
                                          time: state.nextBackupIn,
                                      })
                                    : t('admin.backups.nextBackupCalculating')}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-3 xl:items-end">
                    <div className="flex flex-wrap gap-2">
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
                    <TableSearchToolbar
                        table={table}
                        value={state.searchInput}
                        placeholder={t('admin.backups.table.searchPlaceholder')}
                        showColumnFilters={state.showColumnFilters}
                        onChange={handler.handleSearchInputChange}
                        onToggleFilters={handler.handleToggleColumnFilters}
                    />
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-315 border-collapse text-left text-sm">
                    <TableHead
                        table={table}
                        showColumnFilters={state.showColumnFilters}
                        columnFilterConfigs={state.columnFilterConfigs}
                    />
                    <TableBody
                        table={table}
                        columnCount={state.columnCount}
                        isLoading={backupState.isLoading}
                        searchInput={state.searchInput}
                        loadingState={{
                            description: t('admin.backups.loading'),
                        }}
                        emptyState={{ description: t('admin.backups.empty') }}
                        renderExpandedRow={(row) => (
                            <BackupRestoreRow
                                backupId={row.original.id}
                                columnCount={state.columnCount}
                                state={{
                                    restoreBackupId:
                                        backupState.restoreBackupId,
                                    restoreConfirmation:
                                        backupState.restoreConfirmation,
                                    activeActionId: backupState.activeActionId,
                                }}
                                handler={{
                                    handleCancelRestore:
                                        backupHandler.handleCancelRestore,
                                    handleRestoreConfirmationChange:
                                        backupHandler.handleRestoreConfirmationChange,
                                    handleRestoreBackup:
                                        backupHandler.handleRestoreBackup,
                                }}
                            />
                        )}
                    />
                    <TableFooter
                        table={table}
                        columnCount={state.columnCount}
                        itemLabel={t('admin.backups.table.itemLabel')}
                        pageSizeOptions={state.pageSizeOptions}
                    />
                </table>
            </div>
        </section>
    )
}
