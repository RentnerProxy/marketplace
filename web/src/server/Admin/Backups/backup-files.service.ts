import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { coreSuccessSchema } from '@/server/Core/protocol.ts'
import { getBackupStoragePaths } from './backup-directory.service.ts'

export async function publishBackupFileService(
    sourcePath: string,
    destinationPath: string,
    options: { signal?: AbortSignal } = {},
): Promise<void> {
    await runCoreCommandService(
        'storage',
        {
            operation: 'backupPublishFile',
            ...getBackupStoragePaths(),
            sourcePath,
            destinationPath,
        },
        {
            signal: options.signal,
            validateResult: (value) => coreSuccessSchema.parse(value),
        },
    )
}

export async function deleteBackupFilesService(
    fileNames: readonly string[],
): Promise<void> {
    await runCoreCommandService(
        'storage',
        {
            operation: 'backupDeleteFiles',
            ...getBackupStoragePaths(),
            fileNames,
        },
        { validateResult: (value) => coreSuccessSchema.parse(value) },
    )
}
