import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { APP_STORE_CONFIG } from '@/config/app-store.config.ts'
import {
    getImageBufferFromDataUrl,
    getSafeImageCrop,
} from '@/lib/Images/imageDataUrl.ts'
import { prepareImageVariantSource } from '@/lib/Images/prepareImageVariantSource.ts'
import { getAppStoreImagePaths } from '@/lib/Images/publicImagePaths.ts'
import type { ImageCropArea } from '@/shared/Types/image-crop.types.ts'

export const STORE_IMAGE_ERROR_MESSAGE =
    'Das Bild konnte nicht verarbeitet werden. Erlaubt sind PNG, JPEG und WebP bis 8 MB.'

/**
 * Checks the real format (magic bytes via sharp metadata), the byte and pixel
 * limits, then crops and re-encodes to a fixed-size WebP without metadata.
 */
export async function encodeStoreImageService(
    imageDataUrl: string,
    crop: ImageCropArea,
    kind: 'logo' | 'screenshot',
): Promise<Buffer | null> {
    try {
        const image = await getImageBufferFromDataUrl(imageDataUrl)
        const target = APP_STORE_CONFIG[kind]
        const createVariant = await prepareImageVariantSource(
            image.buffer,
            getSafeImageCrop(crop, image),
            target.width,
            target.height,
        )
        return await createVariant()
            .webp({ quality: target.quality })
            .toBuffer()
    } catch {
        return null
    }
}

/** Writes a new image file atomically and returns its public path. */
export async function writeStoreImageFileService(
    appId: string,
    fileId: string,
    data: Buffer,
) {
    const paths = getAppStoreImagePaths(appId)
    const target = paths.absoluteFile(fileId)
    const temporary = `${target}.${Bun.randomUUIDv7()}.tmp`

    await mkdir(paths.absoluteDir, { recursive: true })
    await writeFile(temporary, data, { flag: 'wx' })
    try {
        await rename(temporary, target)
    } catch (error) {
        await rm(temporary, { force: true })
        throw error
    }

    return paths.relativeFile(fileId)
}

export async function removeStoreImageFilesService(
    appId: string,
    fileIds: Array<string>,
) {
    const paths = getAppStoreImagePaths(appId)
    await Promise.all(
        fileIds.map((fileId) =>
            rm(paths.absoluteFile(fileId), { force: true }),
        ),
    )
}

export function getStoreImageSrc(appId: string, fileId: string | null) {
    return fileId ? getAppStoreImagePaths(appId).relativeFile(fileId) : null
}
