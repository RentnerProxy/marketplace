import type { ExtractBackupArchiveInput } from './backup-service.types.ts'
import type { BackupImportContext } from './import.types.ts'
import type { ValidatedBackupArchive } from './Types/archive-validation.types.ts'
import { withBackupArchiveSourceService } from './archive-plaintext.service.ts'
import {
    getArchiveSourceIdentityService,
    readArchiveProgressService,
    runArchiveCoreService,
} from './archive-core.service.ts'

export function assertExpectedChecksum(expected: string) {
    if (!/^[a-f0-9]{64}$/i.test(expected)) {
        throw new Error('Für das Backup fehlt eine gültige SHA-256-Prüfsumme.')
    }
}

export function assertChecksumMatches(actual: string, expected: string) {
    assertExpectedChecksum(expected)
    if (actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(
            'Die SHA-256-Prüfsumme des Backups stimmt nicht überein.',
        )
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
            const maximumWriteBytes = Number(identity.size) - 70
            await context.beforeWrite(maximumWriteBytes)
            return runArchiveCoreService<ValidatedBackupArchive>(
                {
                    operation: 'validate',
                    sourcePath: filePath,
                    expectedSourceIdentity: identity,
                    temporaryDirectory: context.temporaryDirectory,
                    maximumBytes: context.maximumUploadBytes,
                    maximumWriteBytes,
                },
                context,
            )
        },
    )
}

export async function extractBackupArchive(
    input: ExtractBackupArchiveInput,
): Promise<ValidatedBackupArchive> {
    assertExpectedChecksum(input.expectedChecksumSha256)
    return withBackupArchiveSourceService(
        { filePath: input.filePath, importContext: input.importContext },
        async ({ source, context }) => {
            const identity = await getArchiveSourceIdentityService(source)
            const maximumWriteBytes = 2 * (Number(identity.size) - 70)
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
                context,
                (progress) => {
                    const bytes = readArchiveProgressService(progress)
                    input.onArchiveProgress?.(
                        bytes.processedBytes,
                        bytes.totalBytes,
                    )
                },
            )
        },
    )
}
