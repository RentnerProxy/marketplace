export type BackupErrorHandler = (error: unknown) => void

export type PendingManualBackupIntent = {
    runId: string
    userId: string
    queuedAt: number
}
