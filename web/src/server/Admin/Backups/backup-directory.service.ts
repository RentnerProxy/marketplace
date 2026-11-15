import path from 'node:path'
import { z } from 'zod'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'

export function getBackupStoragePaths() {
    return {
        backupDirectory: path.resolve(
            getRequiredServerEnvironment('BACKUP_DIR'),
        ),
        storageDirectory: path.resolve(
            getRequiredServerEnvironment('APP_STORAGE_DIR'),
        ),
    }
}

export async function getBackupFilePaths(fileNames: string[]) {
    for (const fileName of fileNames) {
        if (
            fileName === '.' ||
            fileName === '..' ||
            fileName.length > 255 ||
            path.basename(fileName) !== fileName ||
            !/^[a-zA-Z0-9._-]+$/.test(fileName)
        ) {
            throw new Error('Ungültiger Backup-Dateiname.')
        }
    }
    const roots = getBackupStoragePaths()
    const expected = fileNames.map((name) =>
        path.join(roots.backupDirectory, name),
    )
    const result = await runCoreCommandService(
        'storage',
        {
            operation: 'backupPreparePaths',
            ...roots,
            fileNames,
        },
        {
            validateResult(value) {
                const parsed = z
                    .object({ paths: z.array(z.string()) })
                    .strict()
                    .parse(value)
                if (
                    parsed.paths.length !== expected.length ||
                    parsed.paths.some((item, index) => item !== expected[index])
                ) {
                    throw new Error('Ungültige Backup-Pfade.')
                }
                return parsed
            },
        },
    )
    return result.paths
}

export async function getBackupFilePath(fileName: string) {
    const [filePath] = await getBackupFilePaths([fileName])
    return filePath
}
