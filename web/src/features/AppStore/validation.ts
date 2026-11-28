import { z } from 'zod'
import { APP_STORE_CONFIG } from '@/config/app-store.config.ts'
import {
    imageCropAreaSchema,
    imageDataUrlSchema,
} from '@/lib/Validation/zodSchemas.ts'
import { appId } from '../../../../contracts/v1/primitives.ts'

export const storeAppInputSchema = z.object({ appId })

export const updateStoreDescriptionInputSchema = z.object({
    appId,
    description: z
        .string()
        .max(APP_STORE_CONFIG.descriptionMaxLength)
        .transform((value) => value.replace(/\r\n?/gu, '\n').trim()),
})

export const uploadStoreImageInputSchema = z.object({
    appId,
    imageDataUrl: imageDataUrlSchema,
    crop: imageCropAreaSchema,
})

export const storeScreenshotInputSchema = z.object({
    appId,
    screenshotId: z.uuidv7(),
})

export const reorderStoreScreenshotsInputSchema = z.object({
    appId,
    screenshotIds: z
        .array(z.uuidv7())
        .min(1)
        .max(APP_STORE_CONFIG.maxScreenshots)
        .refine((ids) => new Set(ids).size === ids.length),
})
