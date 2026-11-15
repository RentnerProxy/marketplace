import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import {
    BACKUP_MANIFEST_VERSION,
    BACKUP_PRIVATE_BACKGROUNDS_VERSION,
} from '@/config/backup.config.ts'
import { getPrivateStorageRoot } from '@/lib/Images/publicImagePaths.ts'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { createPostgresDump } from './process.service.ts'
import { getBackupFilePath } from './backup-directory.service.ts'
import { publishBackupFileService } from './backup-files.service.ts'
import {
    createPrivateTempDirectory,
    removePathBestEffort,
} from './archive-files.service.ts'
import {
    assertBackgroundStoragePathsService,
    collectBackgroundStorageFilesService,
} from './archive-background-storage.service.ts'
import {
    runArchiveCoreService,
    readArchiveProgressService,
} from './archive-core.service.ts'
import { validateBackupArchive } from './archive-validation.service.ts'
import type { BackupManifest } from './Types/archive-validation.types.ts'
import type { CreateBackupArchiveInput } from './backup-service.types.ts'
import type { BackupCreationProgress } from '@/lib/Backups/Types/backup.types.ts'
import { getOrCreateSystemSettingsService } from '@/server/Admin/SystemSettings/settings.service.ts'
import { createBackupFileNameService } from './backup-name.service.ts'

export async function createBackupArchive(input: CreateBackupArchiveInput) {
    await runArchiveCoreService({ operation: 'validateKey' })
    const createdAt = new Date()
    const settings = await getOrCreateSystemSettingsService()
    const fileName = createBackupFileNameService(
        settings.companyName,
        createdAt,
        process.env.BACKUP_TIMEZONE?.trim() || 'Europe/Berlin',
    )
    const outputPath = await getBackupFilePath(fileName)
    const partialPath = `${outputPath}.partial-${randomUUID()}`
    const temporaryDirectory = await createPrivateTempDirectory(
        os.tmpdir(),
        'rentnerproxy-marketplace-backup-',
    )
    let failedPhase: BackupCreationProgress['phase'] | null = null
    let retryAfter = 0
    async function report(
        phase: BackupCreationProgress['phase'],
        processedBytes = 0,
        totalBytes = 0,
    ) {
        if (
            !input.onProgress ||
            (failedPhase === phase && Date.now() < retryAfter)
        )
            return
        try {
            await input.onProgress({
                version: 1,
                phase,
                processedBytes,
                totalBytes,
            })
            failedPhase = null
            retryAfter = 0
        } catch (error) {
            failedPhase = phase
            retryAfter = Date.now() + 5000
            logError('backup.create.progress_publish_failed', error, { phase })
        }
    }
    try {
        await report('preparing')
        const databaseDumpPath = path.join(temporaryDirectory, 'database.dump')
        await createPostgresDump(databaseDumpPath)
        const manifest: BackupManifest = {
            version: BACKUP_MANIFEST_VERSION,
            createdAt: createdAt.toISOString(),
            appVersion: process.env.VITE_APP_VERSION ?? 'unknown',
            ...(input.includesStorage
                ? {
                      includesStorage: true,
                      privateBackgroundsVersion:
                          BACKUP_PRIVATE_BACKGROUNDS_VERSION,
                  }
                : { includesStorage: false }),
        }
        await report('collecting')
        const storageRoot = input.includesStorage
            ? path.resolve(getRequiredServerEnvironment('APP_STORAGE_DIR'))
            : undefined
        const privateStorageRoot = getPrivateStorageRoot()
        let privateEntries: {
            absolutePath: string
            path: string
            size: number
            type: 'file'
        }[] = []
        if (storageRoot) {
            await assertBackgroundStoragePathsService({
                storageRoot,
                privateStorageRoot,
                protectedPaths: [path.dirname(outputPath), temporaryDirectory],
            })
            const backgrounds = await collectBackgroundStorageFilesService({
                storageRoot: privateStorageRoot,
                location: 'private',
            })
            privateEntries = backgrounds.map((entry) => ({
                absolutePath: entry.absolutePath,
                path:
                    'storage/' +
                    entry.publicRelativePath.split(path.sep).join('/'),
                size: entry.size,
                type: 'file',
            }))
        }
        await runArchiveCoreService(
            {
                operation: 'create',
                databaseDumpPath,
                destinationPath: partialPath,
                manifest,
                manifestContent: JSON.stringify(manifest, null, 2),
                mtime: Math.floor(createdAt.getTime() / 1000),
                storageRoot,
                privateEntries,
            },
            undefined,
            async (progress) => {
                const bytes = readArchiveProgressService(progress)
                await report(
                    'archiving',
                    bytes.processedBytes,
                    bytes.totalBytes,
                )
            },
        )
        await report('verifying')
        if (
            !(await removePathBestEffort(
                temporaryDirectory,
                'backup.create.dump_cleanup_failed',
            ))
        ) {
            throw new Error(
                'Der temporäre Datenbank-Dump konnte vor der Archivprüfung nicht sicher bereinigt werden.',
            )
        }
        const result = await validateBackupArchive(partialPath)
        await report('finalizing', result.archiveSize, result.archiveSize)
        await publishBackupFileService(partialPath, outputPath)
        return {
            checksumSha256: result.checksumSha256,
            fileName,
            fileSize: result.archiveSize,
        }
    } catch (error) {
        await removePathBestEffort(
            partialPath,
            'backup.create.partial_cleanup_failed',
        )
        await removePathBestEffort(
            outputPath,
            'backup.create.output_cleanup_failed',
        )
        throw error
    } finally {
        await removePathBestEffort(
            temporaryDirectory,
            'backup.create.temp_cleanup_failed',
        )
    }
}
