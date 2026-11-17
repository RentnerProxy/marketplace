import { TextInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { BackupRestorePanelProps } from '../Types/backup-component-props.types.ts'

export default function BackupRestorePanel({
    backupId,
    state,
    handler,
}: BackupRestorePanelProps) {
    const { t } = useTranslationStore()

    if (state.restoreBackupId !== backupId) return null

    return (
        <div className="rounded-md border border-border-dark border-l-2 border-l-warning bg-background-dark p-4">
            <p
                id={`restore-warning-${backupId}`}
                className="text-sm text-secondary-text"
            >
                {t('admin.backups.restoreWarning')}
                <br />
                {t(
                    'admin.backups.restoreWarningPrivateBackgroundCoverage',
                )}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <TextInput
                    value={state.restoreConfirmation}
                    onChange={(event) =>
                        handler.handleRestoreConfirmationChange(
                            event.target.value,
                        )
                    }
                    placeholder="WIEDERHERSTELLEN"
                    aria-label={t(
                        'admin.backups.restoreConfirmationLabel',
                    )}
                    aria-describedby={`restore-warning-${backupId}`}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    disabled={state.activeActionId === backupId}
                    className="h-10 min-w-0 flex-1 rounded-md"
                />
                <button
                    type="button"
                    onClick={handler.handleRestoreBackup}
                    disabled={
                        state.restoreConfirmation !==
                            'WIEDERHERSTELLEN' ||
                        state.activeActionId === backupId
                    }
                    className="h-10 cursor-pointer whitespace-nowrap rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {t('admin.backups.restoreConfirm')}
                </button>
                <button
                    type="button"
                    onClick={handler.handleCancelRestore}
                    disabled={state.activeActionId === backupId}
                    className="h-10 cursor-pointer rounded-md border border-border-dark bg-input-dark px-4 text-sm text-secondary-text transition-colors hover:border-primary/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {t('common.cancel')}
                </button>
            </div>
        </div>
    )
}
