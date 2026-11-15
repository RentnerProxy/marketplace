import type { BackupImportErrorStatus } from './import.types.ts'

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
