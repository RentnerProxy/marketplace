import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
import { parseArchiveCoreResultService } from './archive-core.schema.ts'
import type {
    BackupArchiveEncryptionMetadata,
    AuthenticateBackupArchiveInput,
} from './Types/archive-encryption.types.ts'

export async function authenticateBackupArchiveService(
    input: AuthenticateBackupArchiveInput,
): Promise<BackupArchiveEncryptionMetadata> {
    return runCoreCommandService(
        'archive',
        {
            operation: 'authenticate',
            sourcePath: input.sourcePath,
            expectedSourceIdentity: input.expectedSourceIdentity,
            expectedChecksumSha256: input.expectedChecksumSha256,
            key: getRequiredServerEnvironment('AUTH_ENCRYPTION_KEY'),
        },
        {
            signal: input.signal,
            validateResult: (result) =>
                parseArchiveCoreResultService<BackupArchiveEncryptionMetadata>(
                    'authenticate',
                    result,
                ),
        },
    )
}
