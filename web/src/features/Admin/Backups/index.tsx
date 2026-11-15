import { HardDriveDownload, Plus, Upload } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useBackupsLogic from './Hooks/useBackupsLogic.ts'
import BackupSettingsCard from './Components/BackupSettingsCard.tsx'
import BackupRunsCard from './Components/BackupRunsCard/index.tsx'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import {
    BACKUP_ARCHIVE_EXTENSION,
    BACKUP_UPLOAD_CONTENT_TYPE,
} from '@/config/backup.config.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

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
            <section className="flex flex-col gap-4 rounded-lg border border-border-dark bg-surface-dark p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                    <HeadingIcon icon={HardDriveDownload} />
                    <div>
                        <h1 className="text-xl font-bold text-white">
                            {t('admin.backups.title')}
                        </h1>
                        <p className="mt-1 text-sm text-secondary-text">
                            {t('admin.backups.description')}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={logic.handler.handleCreateBackup}
                        disabled={logic.state.isCreating}
                        className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <Plus size={17} />
                        {t('admin.backups.createNow')}
                    </button>
                    <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border-dark px-4 font-semibold text-white hover:border-primary/50 has-disabled:cursor-not-allowed has-disabled:opacity-60">
                        <Upload size={17} />
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
                            className="hidden"
                        />
                    </label>
                </div>
            </section>

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
