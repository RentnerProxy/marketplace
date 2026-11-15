import { z } from 'zod'

export const maintenanceSearchSchema = z.object({
    redirect: z.string().optional(),
})

export const requestMaintenanceExtensionInputSchema = z.object({
    reason: z.string().trim().min(10).max(500),
})
