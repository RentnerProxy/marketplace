export type BackgroundBackupWorker = {
    close: () => Promise<void>
    isRunning: () => boolean
}

export type BackupWorkerStartCoordinatorOptions = {
    isRestoreQuiescenceActive: () => Promise<boolean>
    startBackupWorker: () => Promise<BackgroundBackupWorker>
}

export type BackgroundWorkerShutdownOptions = {
    backupWorker: BackgroundBackupWorker | null
    closeMailWorker: () => Promise<void>
}
