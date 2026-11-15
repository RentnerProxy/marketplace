import { z } from 'zod'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { getBackupStoragePaths } from './backup-directory.service.ts'

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
        {
            validateResult: (value) =>
                z
                    .object({ ok: z.literal(true) })
                    .strict()
                    .parse(value),
        },
    )
}
