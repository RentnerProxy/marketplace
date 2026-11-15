import type {
    BackupCreationProgressPhase,
    BackupRunStatus,
    BackupRunTrigger,
} from '@/lib/Backups/Types/backup.types.ts'

export type BackupRun = {
    id: string
    trigger: BackupRunTrigger
    status: BackupRunStatus
    fileName: string | null
    fileSize: number | null
    includesStorage: boolean
    errorMessage: string | null
    startedAt: string
}

export type BackupStats = {
    total: number
    successful: number
    failed: number
    imported: number
    restored: number
}

export type BackupRunCreationProgress = {
    runId: string
    trigger: 'manual' | 'scheduled'
    status: BackupRunStatus
    phase: BackupCreationProgressPhase
    processedBytes: number
    totalBytes: number
    fileName: string | null
    errorMessage: string | null
}
