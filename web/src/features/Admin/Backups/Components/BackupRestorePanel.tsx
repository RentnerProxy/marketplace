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
        <div className="space-y-4">
            <p
                id={`restore-warning-${backupId}`}
                className="comic-notice bg-background-dark p-4 text-sm leading-relaxed text-secondary-text [--notice-tone:var(--color-warning)]"
            >
                {t('admin.backups.restoreWarning')}
                <br />
                {t('admin.backups.restoreWarningPrivateBackgroundCoverage')}
            </p>
            <TextInput
                value={state.restoreConfirmation}
                onChange={(event) =>
                    handler.handleRestoreConfirmationChange(event.target.value)
                }
                placeholder="WIEDERHERSTELLEN"
                aria-label={t('admin.backups.restoreConfirmationLabel')}
                aria-describedby={`restore-warning-${backupId}`}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                disabled={state.activeActionId === backupId}
                className="sm:max-w-sm"
            />
        </div>
    )
}

export function BackupRestoreActions({
    backupId,
    state,
    handler,
}: BackupRestorePanelProps) {
    const { t } = useTranslationStore()
    const isRestoring = state.activeActionId === backupId

    return (
        <>
            <button
                type="button"
                onClick={handler.handleCancelRestore}
                disabled={isRestoring}
                className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-rentner-border bg-rentner-control px-4 py-2 text-sm font-extrabold text-(color:--marketplace-ink-soft) transition-colors enabled:hover:border-focus-ring/40 enabled:hover:text-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
            >
                {t('common.cancel')}
            </button>
            <button
                type="button"
                onClick={handler.handleRestoreBackup}
                disabled={
                    state.restoreConfirmation !== 'WIEDERHERSTELLEN' ||
                    isRestoring
                }
                className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground transition-colors enabled:hover:bg-primary-hover enabled:hover:text-primary-hover-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
            >
                {t('admin.backups.restoreConfirm')}
            </button>
        </>
    )
}
