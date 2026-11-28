import { randomUUID } from 'node:crypto'
import { BACKUP_ARCHIVE_EXTENSION } from '@/config/backup.config.ts'
import { getBackupFilePath } from './backup-directory.service.ts'
import { publishBackupFileService } from './backup-files.service.ts'
import { removePathBestEffort } from './archive-files.service.ts'
import { CoreCommandError } from '@/server/Core/error.ts'
import { validateBackupArchive } from './archive-validation.service.ts'
import type { StagedImportedBackup } from './Types/backup-service.types.ts'
import type { BackupImportContext } from './Types/import.types.ts'

export async function prepareUploadedBackupImport(
    partialPath: string,
    context: BackupImportContext,
): Promise<StagedImportedBackup> {
    context.assertActive()
    const fileName = `import-${randomUUID()}${BACKUP_ARCHIVE_EXTENSION}`
    const destinationPath = await getBackupFilePath(fileName)
    context.assertActive()
    const validated = await validateBackupArchive(partialPath, context)
    context.assertActive()
    let published = false

    return {
        checksumSha256: validated.checksumSha256,
        fileName,
        fileSize: validated.archiveSize,
        includesStorage: validated.manifest.includesStorage,
        publish: async function () {
            context.assertActive()
            try {
                await publishBackupFileService(partialPath, destinationPath, {
                    signal: context.signal,
                })
            } catch (error) {
                if (error instanceof CoreCommandError && error.isUncertain)
                    context.markCleanupIncomplete()
                throw error
            }
            published = true
            context.assertActive()
        },
        dispose: async function () {
            // The upload owns the partial file. Roll back a confirmed publication.
            if (!published) return
            try {
                const removed = await removePathBestEffort(
                    destinationPath,
                    'backup.import.rollback_file_cleanup_failed',
                )
                if (!removed) {
                    throw new Error(
                        'Die Importdatei konnte nicht vollständig entfernt werden.',
                    )
                }
            } catch (error) {
                context.markCleanupIncomplete()
                throw error
            }
        },
    }
}
