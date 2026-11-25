import path from 'node:path'
import { BACKUP_ARCHIVE_OVERHEAD_BYTES } from '@/config/backup.config.ts'
import type { ExtractBackupArchiveInput } from './Types/backup-service.types.ts'
import type { BackupImportContext } from './Types/import.types.ts'
import type { ValidatedBackupArchive } from './Types/archive-validation.types.ts'
import type { StageBackupArchiveInput } from './Types/archive-restore.types.ts'
import { withBackupArchiveSourceService } from './archive-plaintext.service.ts'
import {
    getArchiveSourceIdentityService,
    runArchiveCoreService,
} from './archive-core.service.ts'

export function assertExpectedChecksum(expected: string) {
    if (!/^[a-f0-9]{64}$/i.test(expected)) {
        throw new Error('Für das Backup fehlt eine gültige SHA-256-Prüfsumme.')
    }
}

export async function validateBackupArchive(
    filePath: string,
    importContext?: BackupImportContext,
): Promise<ValidatedBackupArchive> {
    return withBackupArchiveSourceService(
        { filePath, importContext },
        async ({ source, context }) => {
            const identity = await getArchiveSourceIdentityService(source)
            return runArchiveCoreService<ValidatedBackupArchive>(
                {
                    operation: 'validate',
                    sourcePath: filePath,
                    expectedSourceIdentity: identity,
                    maximumBytes: context.maximumUploadBytes,
                },
                { context },
            )
        },
    )
}

export async function extractBackupArchive(
    input: ExtractBackupArchiveInput,
): Promise<ValidatedBackupArchive> {
    assertExpectedChecksum(input.expectedChecksumSha256)
    return withBackupArchiveSourceService(
        {
            filePath: input.filePath,
            importContext: input.importContext,
            forRestore: true,
        },
        async ({ source, context }) => {
            const identity = await getArchiveSourceIdentityService(source)
            // Reserve both the temporary TAR and its extracted payload.
            const maximumWriteBytes =
                2 * (Number(identity.size) - BACKUP_ARCHIVE_OVERHEAD_BYTES)
            await context.beforeWrite(maximumWriteBytes)
            return runArchiveCoreService<ValidatedBackupArchive>(
                {
                    operation: 'extract',
                    sourcePath: input.filePath,
                    expectedSourceIdentity: identity,
                    expectedChecksumSha256: input.expectedChecksumSha256,
                    destinationDirectory: input.destinationDirectory,
                    temporaryDirectory: context.temporaryDirectory,
                    maximumBytes: context.maximumUploadBytes,
                    maximumWriteBytes,
                },
                {
                    context,
                    onProgress(processedBytes, totalBytes) {
                        input.onArchiveProgress?.(processedBytes, totalBytes)
                    },
                },
            )
        },
    )
}

export async function stageBackup(input: StageBackupArchiveInput) {
    input.importContext.assertActive()
    assertExpectedChecksum(input.expectedChecksumSha256)
    const identity = await getArchiveSourceIdentityService(input.source)
    const size = Number(identity.size)
    if (
        size < BACKUP_ARCHIVE_OVERHEAD_BYTES ||
        size > input.importContext.maximumUploadBytes
    ) {
        throw new Error('Die Backup-Quelldatei ist ungültig oder zu groß.')
    }
    const stagedPath = path.join(input.stagingDirectory, input.stagingFileName)
    await input.importContext.beforeWrite(size)
    await runArchiveCoreService(
        {
            operation: 'copy',
            sourcePath: input.sourcePath,
            destinationPath: stagedPath,
            expectedSourceIdentity: identity,
            expectedChecksumSha256: input.expectedChecksumSha256,
            maximumBytes: input.importContext.maximumUploadBytes,
            maximumWriteBytes: size,
        },
        {
            context: input.importContext,
            onProgress(processedBytes, totalBytes) {
                input.onProgress?.(processedBytes, totalBytes)
            },
        },
    )
    return stagedPath
}
