import {
    getPublicStorageRoot,
    getUserPublicImagePaths,
} from '@/lib/Images/publicImagePaths.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import type { NativeBackgroundReadResult } from './Types/background-storage.types.ts'
import { z } from 'zod'

const MAXIMUM_BACKGROUND_BYTES = 8 * 1024 * 1024
const nativeBackgroundResultSchema = z
    .custom<Buffer>(
        (value) =>
            Buffer.isBuffer(value) &&
            value.byteLength <= MAXIMUM_BACKGROUND_BYTES,
        'Der Storage-Core hat ungültige Hintergrunddaten gemeldet.',
    )
    .nullable()

export async function readCurrentUserBackgroundFileService(
    userId: string,
): Promise<Buffer | null> {
    const paths = getUserPublicImagePaths(userId)
    return runCoreCommandService<NativeBackgroundReadResult>(
        'storage',
        {
            operation: 'readBackgroundBytes',
            rootDirectory: paths.absolutePrivateStorageRoot,
            directoryPath: paths.absoluteBackgroundDir,
            filePath: paths.absoluteBackground,
            legacyPath: paths.absoluteLegacyBackground,
            legacyRoot: getPublicStorageRoot(),
        },
        {
            validateResult: (nativeResult) =>
                nativeBackgroundResultSchema.parse(nativeResult),
        },
    )
}
