import type { sessions } from '@/db/schema.ts'
import type { BackupRestoreProgress } from '@/lib/Backups/Types/backup.types.ts'
import type { ValidatedBackupArchive } from './archive-validation.types.ts'
import type { PreparedBackgroundStorage } from './archive-background-storage.types.ts'
import type { FileHandle } from 'node:fs/promises'
import type { BackupByteProgressReporter } from './backup-service.types.ts'
import type { BackupImportContext } from './import.types.ts'

export type StageBackupArchiveInput = {
    source: FileHandle
    sourcePath: string
    expectedChecksumSha256: string
    stagingDirectory: string
    stagingFileName: string
    importContext: BackupImportContext
    onProgress?: BackupByteProgressReporter
}

type RestoreProgressEmitter = (
    phase: BackupRestoreProgress['phase'],
    percent: number | null,
    processedBytes?: number,
    totalBytes?: number,
) => Promise<void>

export type RestoreExtractedBackupArchiveInput = {
    validated: ValidatedBackupArchive
    restoreDirectory: string
    storageRoot: string
    privateStorageRoot: string
    privateBackgrounds?: PreparedBackgroundStorage
    beforeRestoreMutation?: () => Promise<void>
    afterDatabaseRestore?: () => Promise<void>
    afterRestoreApplied?: () => Promise<void>
    emitProgress: RestoreProgressEmitter
    storageMutationBarrierHeld?: boolean
}

export type RestoreSessionSnapshot = typeof sessions.$inferSelect
