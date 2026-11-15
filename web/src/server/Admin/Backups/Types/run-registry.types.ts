import type {
    BackupRunTrigger,
    BackupRunStatus,
} from '@/lib/Backups/Types/backup.types.ts'
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
