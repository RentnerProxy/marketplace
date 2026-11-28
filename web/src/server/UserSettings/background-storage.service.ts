import {
    getPublicStorageRoot,
    getUserPublicImagePaths,
} from '@/lib/Images/publicImagePaths.ts'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'
import type {
    BackgroundFile,
    BackgroundFileMetadata,
} from './Types/background-storage.types.ts'
import { z } from 'zod'

const backgroundVersionSchema = z.string().regex(/^[a-f0-9]{64}$/)
const backgroundMetadataSchema = z
    .strictObject({
        version: backgroundVersionSchema,
        size: z.number().int().min(0).max(CORE_RUNTIME.maxBinaryOutputBytes),
    })
    .nullable()
const backgroundFileSchema = z
    .strictObject({
        version: backgroundVersionSchema,
        bytes: z.custom<Buffer<ArrayBuffer>>(
            (value) =>
                Buffer.isBuffer(value) &&
                value.buffer instanceof ArrayBuffer &&
                value.byteLength <= CORE_RUNTIME.maxBinaryOutputBytes,
            'Der Storage-Core hat ungültige Hintergrunddaten gemeldet.',
        ),
    })
    .nullable()

function createBackgroundStorageRequest(
    userId: string,
    operation: 'readBackgroundRepresentation' | 'statBackground',
) {
    const paths = getUserPublicImagePaths(userId)
    return {
        operation,
        rootDirectory: paths.absolutePrivateStorageRoot,
        directoryPath: paths.absoluteBackgroundDir,
        filePath: paths.absoluteBackground,
        legacyPath: paths.absoluteLegacyBackground,
        legacyRoot: getPublicStorageRoot(),
    }
}

export function statCurrentUserBackgroundFileService(
    userId: string,
): Promise<BackgroundFileMetadata | null> {
    return runCoreCommandService(
        'storage',
        createBackgroundStorageRequest(userId, 'statBackground'),
        { validateResult: (result) => backgroundMetadataSchema.parse(result) },
    )
}

export async function readCurrentUserBackgroundFileService(
    userId: string,
): Promise<BackgroundFile | null> {
    const result = await runCoreCommandService(
        'storage',
        createBackgroundStorageRequest(userId, 'readBackgroundRepresentation'),
        { validateResult: (value) => backgroundFileSchema.parse(value) },
    )
    return result && { ...result, size: result.bytes.byteLength }
}
