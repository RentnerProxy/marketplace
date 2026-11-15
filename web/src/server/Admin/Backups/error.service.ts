export const BACKUP_FAILURE_MESSAGE = 'Der Backup-Vorgang ist fehlgeschlagen.'

export function getStoredBackupErrorMessageService(
    errorMessage: string | null,
) {
    return errorMessage === null ? null : BACKUP_FAILURE_MESSAGE
}
