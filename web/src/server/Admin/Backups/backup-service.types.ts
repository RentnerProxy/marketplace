import type { CompleteRestoreQuiescence } from '@/server/Queues/Types/mail-restore-quiescence.types.ts'
import type { BackupImportContext } from './import.types.ts'
import type { db } from '@/db'

import type {
    BackupCreationProgress,
    BackupJobProgress,
    BackupRestoreProgress,
} from '@/lib/Backups/Types/backup.types.ts'

export type BackupProgressReporter<
    TProgress extends BackupJobProgress = BackupJobProgress,
> = (progress: TProgress) => void | Promise<void>

export type BackupByteProgressReporter = (
    processedBytes: number,
    totalBytes: number,
) => void

export type BackupJobExecutionOptions = {
    completeRestoreQuiescence?: CompleteRestoreQuiescence
    reportProgress?: BackupProgressReporter
}

export type CreateBackupArchiveInput = {
    includesStorage: boolean
    onProgress?: BackupProgressReporter<BackupCreationProgress>
}

export type ExtractBackupArchiveInput = {
    importContext?: BackupImportContext
    destinationDirectory: string
    expectedChecksumSha256: string
    filePath: string
    onArchiveProgress?: BackupByteProgressReporter
}

export type RestoreBackupArchiveInput = {
    filePath: string
    expectedChecksumSha256: string
    expectedIncludesStorage?: boolean
    beforeRestoreMutation?: () => Promise<void>
    afterDatabaseRestore?: () => Promise<void>
    afterRestoreApplied?: () => Promise<void>
    onProgress?: BackupProgressReporter<BackupRestoreProgress>
    storageMutationBarrierHeld?: boolean
}

export type BackupRunWriteExecutor = Pick<typeof db, 'insert'>

type ImportedBackupArchive = {
    fileName: string
    fileSize: number
    checksumSha256: string
    includesStorage: boolean
}

export type StagedImportedBackup = ImportedBackupArchive & {
    publish: () => Promise<void>
    dispose: () => Promise<void>
}

export type RegisterImportedBackupInput = ImportedBackupArchive & {
    userId: string
}

export type BackupApiErrorStatus = 400 | 404 | 408 | 409 | 500
