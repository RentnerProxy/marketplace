import type { PrivateStorageFileWriteInput } from './Types/private-files.types.ts'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'

export async function preparePrivateStorageDirectoryService(
    rootDirectory: string,
    directoryPath: string,
): Promise<void> {
    await runCoreCommandService('storage', {
        operation: 'prepareDirectories',
        rootDirectory,
        directoryPath,
    })
}

export async function writePrivateStorageFileService(
    input: PrivateStorageFileWriteInput,
): Promise<void> {
    if (
        !(input.data instanceof Uint8Array) ||
        input.data.byteLength > CORE_RUNTIME.maxBinaryInputBytes
    )
        throw new Error('Private storage operation failed.')
    await runCoreCommandService(
        'storage',
        {
            operation: 'writeFile',
            rootDirectory: input.rootDirectory,
            filePath: input.filePath,
        },
        { binaryInput: input.data },
    )
}
