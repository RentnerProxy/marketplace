import type { PrivateStorageFileWriteInput } from './Types/private-files.types.ts'
import { PRIVATE_STORAGE_WRITE } from '@/config/private-storage.config.ts'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import { isLinuxPrivateStorageWriteSupportedService } from './linux-private-write.service.ts'
import { runPrivateStorageWriteService } from './private-write-queue.service.ts'

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
    if (
        input.data.byteLength >= PRIVATE_STORAGE_WRITE.directMinimumBytes &&
        isLinuxPrivateStorageWriteSupportedService()
    ) {
        await runPrivateStorageWriteService(input)
        return
    }
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
