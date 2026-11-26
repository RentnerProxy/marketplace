import type {
    BackupCreationProgress,
    BackupRunTrigger,
    BackupRunStatus,
} from '@/lib/Backups/Types/backup.types.ts'
import type { backupRuns } from '@/db/schema.ts'
import type { BackupProgressReporter } from './backup-service.types.ts'

export type BackupRunRecord = typeof backupRuns.$inferSelect

export type BackupDeletionActor =
    { kind: 'user'; userId: string } | { kind: 'retention' }

export type ExecuteCreateBackupOptions = {
    deferFailureToQueue?: boolean
    reportProgress?: BackupProgressReporter<BackupCreationProgress>
}

export type CreateRunInput = {
    id?: string
    trigger: Exclude<BackupRunTrigger, 'restore'>
    includesStorage: boolean
    createdByUserId?: string
    fileName?: string
    fileSize?: number
    checksumSha256?: string
    status?: Extract<BackupRunStatus, 'completed' | 'queued'>
}
