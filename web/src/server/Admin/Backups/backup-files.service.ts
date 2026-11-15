import { z } from 'zod'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
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
            validateResult: (value) =>
                z
                    .object({ ok: z.literal(true) })
                    .strict()
                    .parse(value),
        },
    )
}
