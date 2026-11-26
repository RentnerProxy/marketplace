import sharp, { type Region } from 'sharp'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'

export async function prepareImageVariantSource(
    input: Buffer,
    crop: Region,
    width: number,
    height: number,
) {
    // Materialize the largest output as pixels so smaller variants reuse the
    // same crop without retaining a full-resolution image or encoding it twice.
    const { data, info } = await sharp(input, {
        limitInputPixels: IMAGE_UPLOAD_CONFIG.maxInputPixels,
    })
        .extract(crop)
        .resize(width, height, { fit: 'cover' })
        .toColorspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true })
    const raw = {
        width: info.width,
        height: info.height,
        channels: info.channels,
    }
    return () => sharp(data, { raw })
}
