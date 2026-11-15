import sharp from 'sharp'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'

const MIME_TO_SHARP_FORMAT = {
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
} as const

export async function getImageBufferFromDataUrl(
    imageDataUrl: string,
    errorMessage = 'Das Bild konnte nicht gelesen werden.',
) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(
        imageDataUrl,
    )

    if (!match) {
        throw new Error(errorMessage)
    }

    const mimeType = match[1]
    const base64 = match[2]

    if (
        mimeType !== 'image/jpeg' &&
        mimeType !== 'image/png' &&
        mimeType !== 'image/webp'
    ) {
        throw new Error(
            'Erlaubt sind ausschließlich JPEG-, PNG- und WebP-Bilder.',
        )
    }

    const estimatedBytes = Math.floor((base64.length * 3) / 4)

    if (estimatedBytes > IMAGE_UPLOAD_CONFIG.maxInputBytes) {
        throw new Error(
            'Das Bild überschreitet die maximal erlaubte Dateigröße.',
        )
    }

    const buffer = Buffer.from(base64, 'base64')

    if (
        buffer.byteLength === 0 ||
        buffer.byteLength > IMAGE_UPLOAD_CONFIG.maxInputBytes
    ) {
        throw new Error(errorMessage)
    }

    const metadata = await sharp(buffer, {
        failOn: 'error',
        limitInputPixels: IMAGE_UPLOAD_CONFIG.maxInputPixels,
    }).metadata()

    if (
        metadata.format !== MIME_TO_SHARP_FORMAT[mimeType] ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > IMAGE_UPLOAD_CONFIG.maxInputPixels
    ) {
        throw new Error(
            'Der tatsächliche Bildtyp oder die Bildgröße ist nicht erlaubt.',
        )
    }

    return {
        buffer,
        height: metadata.height,
        width: metadata.width,
    }
}

export function getSafeImageCrop(
    crop: { x: number; y: number; width: number; height: number },
    image: { width: number; height: number },
) {
    const safeCrop = {
        left: Math.max(0, Math.round(crop.x)),
        top: Math.max(0, Math.round(crop.y)),
        width: Math.max(1, Math.round(crop.width)),
        height: Math.max(1, Math.round(crop.height)),
    }

    if (
        safeCrop.left + safeCrop.width > image.width ||
        safeCrop.top + safeCrop.height > image.height
    ) {
        throw new Error(
            'Der gewählte Bildausschnitt liegt außerhalb des Bildes.',
        )
    }

    return safeCrop
}
