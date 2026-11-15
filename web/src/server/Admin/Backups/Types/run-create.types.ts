import type { BackupCreationProgress } from '@/lib/Backups/Types/backup.types.ts'
import type { BackupProgressReporter } from '../backup-service.types.ts'

export type ExecuteCreateBackupOptions = {
    deferFailureToQueue?: boolean
    reportProgress?: BackupProgressReporter<BackupCreationProgress>
}
