import { Plus, Upload } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useBackupsLogic from './Hooks/useBackupsLogic.ts'
import BackupSettingsCard from './Components/BackupSettingsCard.tsx'
import BackupRunsCard from './Components/BackupRunsCard/index.tsx'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import {
    BACKUP_ARCHIVE_EXTENSION,
    BACKUP_UPLOAD_CONTENT_TYPE,
} from '@/config/backup.config.ts'

export default function Backups() {
    const { t } = useTranslationStore()
    const logic = useBackupsLogic()

    return (
        <div className="space-y-6">
            <SafeDeleteModal
                isOpen={Boolean(logic.state.deleteBackupId)}
                question={t('admin.backups.deleteQuestion', {
                    fileName:
                        logic.state.deleteBackup?.fileName ??
                        t('admin.backups.unknownBackup'),
                })}
                title={t('admin.backups.deleteTitle')}
                description={t('admin.backups.deleteDescription')}
                confirmLabel={t('admin.backups.delete')}
                isConfirming={
                    logic.state.activeActionId === logic.state.deleteBackupId
                }
                onClose={logic.handler.handleCancelDeleteBackup}
                onConfirm={logic.handler.handleConfirmDeleteBackup}
            />
            <div
                role="group"
                aria-label={t('admin.backups.title')}
                className="flex flex-wrap justify-end gap-2"
            >
                <button
                    type="button"
                    onClick={logic.handler.handleCreateBackup}
                    disabled={logic.state.isCreating}
                    className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 text-sm font-extrabold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                >
                    <Plus className="size-4" aria-hidden="true" />
                    {t('admin.backups.createNow')}
                </button>
                <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-(--marketplace-border-strong) bg-input-dark px-4 text-sm font-extrabold text-(color:--marketplace-ink-soft) transition-colors hover:border-primary/45 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring has-disabled:cursor-not-allowed has-disabled:opacity-55 motion-reduce:transition-none">
                    <Upload className="size-4" aria-hidden="true" />
                    {logic.state.isImporting
                        ? t('admin.backups.importing')
                        : t('admin.backups.import')}
                    <input
                        type="file"
                        aria-label={t('admin.backups.import')}
                        accept={`${BACKUP_ARCHIVE_EXTENSION},${BACKUP_UPLOAD_CONTENT_TYPE}`}
                        disabled={logic.state.isImporting}
                        onChange={(event) => {
                            logic.handler.handleImportBackup(
                                event.target.files?.[0] ?? null,
                            )
                            event.target.value = ''
                        }}
                        className="sr-only"
                    />
                </label>
            </div>

            <div className="flex w-full flex-col gap-6">
                <BackupSettingsCard
                    state={{
                        settings: logic.state.settings,
                        isSaving: logic.state.isSaving,
                    }}
                    handler={{
                        handleSettingsChange:
                            logic.handler.handleSettingsChange,
                        handleSaveSettings: logic.handler.handleSaveSettings,
                    }}
                />
                <BackupRunsCard
                    state={{
                        isAutomaticBackupEnabled:
                            logic.state.settings.isEnabled,
                        runs: logic.state.runs,
                        stats: logic.state.stats,
                        nextBackupAt: logic.state.nextBackupAt,
                        restoreBackupId: logic.state.restoreBackupId,
                        restoreConfirmation: logic.state.restoreConfirmation,
                        isLoading: logic.state.isLoading,
                        activeActionId: logic.state.activeActionId,
                    }}
                    handler={{
                        handleDeleteBackup: logic.handler.handleDeleteBackup,
                        handleOpenRestore: logic.handler.handleOpenRestore,
                        handleCancelRestore: logic.handler.handleCancelRestore,
                        handleRestoreConfirmationChange:
                            logic.handler.handleRestoreConfirmationChange,
                        handleRestoreBackup: logic.handler.handleRestoreBackup,
                    }}
                />
            </div>
        </div>
    )
}
