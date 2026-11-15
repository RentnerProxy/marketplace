import { z } from 'zod'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'

export const imageCropAreaSchema = z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
})

export const imageDataUrlSchema = z
    .string()
    .max(Math.ceil((IMAGE_UPLOAD_CONFIG.maxInputBytes * 4) / 3) + 100)
    .regex(/^data:image\/(jpeg|png|webp);base64,/)

export const webAuthnResponseSchema = z.looseObject({
    id: z.string().min(1),
    rawId: z.string().min(1),
    response: z.record(z.string(), z.unknown()),
    clientExtensionResults: z.record(z.string(), z.unknown()),
    type: z.literal('public-key'),
    authenticatorAttachment: z.string().optional(),
})

export function optionalTextSchema(maxLength: number) {
    return z.string().trim().max(maxLength).optional().default('')
}
