import { z } from 'zod'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import { getPublicStorageRoot } from '@/lib/Images/publicImagePaths.ts'
import { runCoreCommandService } from '@/server/Core/command.service.ts'

export async function publishSystemBrandingStorageService(
    largeLogo: Buffer,
    smallLogo: Buffer,
    favicon: Buffer,
): Promise<void> {
    for (const data of [largeLogo, smallLogo, favicon]) {
        if (
            !Buffer.isBuffer(data) ||
            data.byteLength === 0 ||
            data.byteLength > IMAGE_UPLOAD_CONFIG.maxInputBytes
        ) {
            throw new Error('Das Logo konnte nicht gelesen werden.')
        }
    }
    const binaryLengths = [
        largeLogo.byteLength,
        smallLogo.byteLength,
        favicon.byteLength,
    ]
    const totalBytes = binaryLengths.reduce(
        (total, length) => total + length,
        0,
    )
    if (totalBytes > CORE_RUNTIME.maxBrandingInputBytes) {
        throw new Error('Das Logo konnte nicht gelesen werden.')
    }
    await runCoreCommandService(
        'storage',
        {
            operation: 'brandingPublish',
            rootDirectory: getPublicStorageRoot(),
            binaryLengths,
        },
        {
            binaryInput: Buffer.concat(
                [largeLogo, smallLogo, favicon],
                totalBytes,
            ),
            validateResult: (value) =>
                z
                    .object({ ok: z.literal(true) })
                    .strict()
                    .parse(value),
        },
    )
}
