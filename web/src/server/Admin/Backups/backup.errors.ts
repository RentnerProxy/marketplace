import type { BackupImportErrorStatus } from './Types/import.types.ts'

export const BACKUP_FAILURE_MESSAGE = 'Der Backup-Vorgang ist fehlgeschlagen.'

export function getStoredBackupErrorMessageService(
    errorMessage: string | null,
) {
    return errorMessage === null ? null : BACKUP_FAILURE_MESSAGE
}

export class BackupImportError extends Error {
    readonly status: BackupImportErrorStatus

    constructor(
        status: BackupImportErrorStatus,
        message: string,
        options?: ErrorOptions,
    ) {
        super(message, options)
        this.name = 'BackupImportError'
        this.status = status
    }
}
