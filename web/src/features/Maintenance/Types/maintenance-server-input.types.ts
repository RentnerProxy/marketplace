import type { z } from 'zod'
import type { requestMaintenanceExtensionInputSchema } from '../validation.ts'

export type RequestMaintenanceExtensionInput = z.infer<
    typeof requestMaintenanceExtensionInputSchema
>
