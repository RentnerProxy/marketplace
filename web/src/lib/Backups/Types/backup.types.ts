export type BackupSettings = {
    isEnabled: boolean
    targetKey: string
    scheduleType: 'daily' | 'weekdays' | 'interval-hours' | 'interval-weeks'
    scheduleInterval: number
    scheduleWeekdays: string
    scheduleHour: number
    scheduleMinute: number
    retentionMode: 'days' | 'count' | 'both'
    retentionDays: number
    retentionCount: number
    includeStorage: boolean
}

export type UpdateBackupSettingsInput = Omit<BackupSettings, 'targetKey'>

export type BackupRunTrigger =
    'manual' | 'scheduled' | 'restore-safety' | 'import' | 'restore'

export type BackupRunStatus = 'queued' | 'running' | 'completed' | 'failed'

export type BackupCreationProgressPhase =
    | 'queued'
    | 'preparing'
    | 'collecting'
    | 'archiving'
    | 'verifying'
    | 'finalizing'

export type BackupCreationProgress = {
    version: 1
    phase: Exclude<BackupCreationProgressPhase, 'queued'>
    processedBytes: number
    totalBytes: number
}

export type BackupRestoreProgressPhase =
    | 'preparing'
    | 'validating'
    | 'creating-recovery'
    | 'replacing-storage'
    | 'restoring-database'
    | 'finalizing'
    | 'rolling-back'

export type BackupRestoreProgress = {
    version: 1
    phase: BackupRestoreProgressPhase
    percent: number | null
    processedBytes: number
    totalBytes: number
    updatedAt: string
}

export type BackupJobProgress = BackupCreationProgress | BackupRestoreProgress
