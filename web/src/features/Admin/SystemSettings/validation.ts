import { z } from 'zod'
import {
    imageCropAreaSchema,
    imageDataUrlSchema,
} from '@/lib/Validation/zodSchemas.ts'

export const updateCompanyNameInputSchema = z.object({
    companyName: z.string().trim().min(1).max(100),
})

export const updateSystemLogoInputSchema = z.object({
    imageDataUrl: imageDataUrlSchema,
    crop: imageCropAreaSchema,
})

export const updateMaintenanceModeInputSchema = z.discriminatedUnion(
    'isEnabled',
    [
        z.object({
            isEnabled: z.literal(true),
            startsAt: z.iso.datetime(),
        }),
        z.object({
            isEnabled: z.literal(false),
            startsAt: z.iso.datetime().optional(),
        }),
    ],
)

export const resolveMaintenanceExtensionRequestInputSchema = z.object({
    requestId: z.uuid(),
    status: z.enum(['approved', 'rejected']),
    extensionMinutes: z.number().int().min(1).max(120).optional(),
})
