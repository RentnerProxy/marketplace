import path from 'node:path'
import {
    getArchiveSourceIdentityService,
    readArchiveProgressService,
    runArchiveCoreService,
} from './archive-core.service.ts'
import { assertExpectedChecksum } from './archive-validation.service.ts'
import type { StageBackupArchiveInput } from './Types/archive-restore.types.ts'

export async function stageBackup(input: StageBackupArchiveInput) {
    input.importContext.assertActive()
    assertExpectedChecksum(input.expectedChecksumSha256)
    const identity = await getArchiveSourceIdentityService(input.source)
    const size = Number(identity.size)
    if (size < 70 || size > input.importContext.maximumUploadBytes) {
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
        input.importContext,
        (progress) => {
            const bytes = readArchiveProgressService(progress)
            input.onProgress?.(bytes.processedBytes, bytes.totalBytes)
        },
    )
    return stagedPath
}
