import path from 'node:path'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { logError } from '@/server/Logging/logger.ts'
import { nativeStorageAbsolutePathSchema } from '@/server/Storage/private-paths.service.ts'

export function hasFileSystemErrorCode(error: unknown, code: string) {
    return error instanceof Error && 'code' in error && error.code === code
}

export function isPathInside(parentPath: string, candidatePath: string) {
    const relativePath = path.relative(parentPath, candidatePath)
    return (
        relativePath === '' ||
        (!relativePath.startsWith(`..${path.sep}`) &&
            relativePath !== '..' &&
            !path.isAbsolute(relativePath))
    )
}

export async function removePathBestEffort(filePath: string, event: string) {
    try {
        await runCoreCommandService('storage', {
            operation: 'remove',
            path: filePath,
        })
        return true
    } catch (error) {
        logError(event, error, { path: path.basename(filePath) })
        return false
    }
}

export async function createPrivateTempDirectory(
    parent: string,
    prefix: string,
) {
    return runCoreCommandService<string>(
        'storage',
        {
            operation: 'tempDirectory',
            path: parent,
            prefix,
        },
        {
            validateResult(result) {
                const directory = nativeStorageAbsolutePathSchema.parse(result)
                const name = path.basename(directory)
                if (
                    path.dirname(directory) !== path.resolve(parent) ||
                    !name.startsWith(prefix) ||
                    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                        name.slice(prefix.length),
                    )
                )
                    throw new Error(
                        'Der Storage-Core hat einen ungültigen temporären Pfad gemeldet.',
                    )
                return directory
            },
        },
    )
}

export async function assertDirectoryMutationPermissions(
    parentDirectory: string,
) {
    await runCoreCommandService('storage', {
        operation: 'permissions',
        path: parentDirectory,
    })
}

export async function syncFile(filePath: string) {
    await runCoreCommandService('storage', {
        operation: 'syncFile',
        path: filePath,
    })
}

export async function syncDirectory(directoryPath: string) {
    await runCoreCommandService('storage', {
        operation: 'syncDirectory',
        path: directoryPath,
    })
}
