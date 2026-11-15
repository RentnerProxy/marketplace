import {
    getArchiveSourceIdentityService,
    runArchiveCoreService,
} from './archive-core.service.ts'
import path from 'node:path'
import { open } from 'node:fs/promises'

import { randomUUID } from 'node:crypto'
import { BACKUP_ARCHIVE_EXTENSION } from '@/config/backup.config.ts'
import { getBackupFilePath } from './backup-directory.service.ts'
import { publishBackupFileService } from './backup-files.service.ts'
import { removePathBestEffort } from './archive-files.service.ts'
import { CoreCommandError } from '@/server/Core/error.ts'
import { validateBackupArchive } from './archive-validation.service.ts'
import type { StagedImportedBackup } from './backup-service.types.ts'
import type { BackupImportContext } from './import.types.ts'

async function removeOwnedImportPath(
    filePath: string,
    event: string,
    context: BackupImportContext,
) {
    try {
        if (!(await removePathBestEffort(filePath, event))) {
            throw new Error(
                'Die Importdatei konnte nicht vollständig entfernt werden.',
            )
        }
    } catch (error) {
        context.markCleanupIncomplete()
        throw error
    }
}

export async function copyImportedBackup(
    sourcePath: string,
    context: BackupImportContext,
): Promise<StagedImportedBackup> {
    context.assertActive()
    const importedFileName = `import-${randomUUID()}${BACKUP_ARCHIVE_EXTENSION}`
    const destinationPath = await getBackupFilePath(importedFileName)
    context.assertActive()
    const partialPath = path.join(
        context.temporaryDirectory,
        `${importedFileName}.partial-${randomUUID()}`,
    )
    let ownsPartialFile = false

    try {
        const source = await open(sourcePath, 'r')
        try {
            const identity = await getArchiveSourceIdentityService(source)
            const size = Number(identity.size)
            if (size > context.maximumUploadBytes)
                throw new Error(
                    'Die Backup-Kopie überschreitet das Größenlimit.',
                )
            await context.beforeWrite(size)
            await runArchiveCoreService(
                {
                    operation: 'copy',
                    sourcePath,
                    destinationPath: partialPath,
                    expectedSourceIdentity: identity,
                    maximumBytes: context.maximumUploadBytes,
                    maximumWriteBytes: size,
                },
                context,
            )
            ownsPartialFile = true
        } finally {
            await source.close().catch((error) => {
                context.markCleanupIncomplete()
                throw error
            })
        }
        context.assertActive()
        const validated = await validateBackupArchive(partialPath, context)
        context.assertActive()
        let published = false

        return {
            checksumSha256: validated.checksumSha256,
            fileName: importedFileName,
            fileSize: validated.archiveSize,
            includesStorage: validated.manifest.includesStorage,
            publish: async function () {
                context.assertActive()
                try {
                    await publishBackupFileService(
                        partialPath,
                        destinationPath,
                        { signal: context.signal },
                    )
                } catch (error) {
                    if (error instanceof CoreCommandError && error.isUncertain)
                        context.markCleanupIncomplete()
                    throw error
                }
                published = true
                context.assertActive()
            },
            dispose: async function () {
                const cleanup = [
                    removeOwnedImportPath(
                        partialPath,
                        'backup.import.partial_cleanup_failed',
                        context,
                    ),
                ]
                if (published) {
                    cleanup.push(
                        removeOwnedImportPath(
                            destinationPath,
                            'backup.import.rollback_file_cleanup_failed',
                            context,
                        ),
                    )
                }
                const outcomes = await Promise.allSettled(cleanup)
                const errors = outcomes.flatMap((outcome) =>
                    outcome.status === 'rejected' ? [outcome.reason] : [],
                )
                if (errors.length > 0) {
                    throw new AggregateError(
                        errors,
                        'Die Importdateien konnten nicht vollständig entfernt werden.',
                    )
                }
            },
        }
    } catch (error) {
        if (ownsPartialFile) {
            const cleanupFailure = await removeOwnedImportPath(
                partialPath,
                'backup.import.partial_cleanup_failed',
                context,
            ).then(
                () => undefined,
                (cleanupError: unknown) => ({ error: cleanupError }),
            )
            if (cleanupFailure) {
                throw new AggregateError(
                    [error, cleanupFailure.error],
                    'Der Import und seine Bereinigung sind fehlgeschlagen.',
                    { cause: error },
                )
            }
        }
        throw error
    }
}
