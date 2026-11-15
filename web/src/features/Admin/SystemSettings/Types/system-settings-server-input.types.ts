import type { z } from 'zod'
import type {
    resolveMaintenanceExtensionRequestInputSchema,
    updateCompanyNameInputSchema,
    updateMaintenanceModeInputSchema,
    updateSystemLogoInputSchema,
} from '../validation.ts'

export type ResolveMaintenanceExtensionRequestInput = z.infer<
    typeof resolveMaintenanceExtensionRequestInputSchema
>
export type UpdateCompanyNameInput = z.infer<
    typeof updateCompanyNameInputSchema
>
export type UpdateMaintenanceModeInput = z.infer<
    typeof updateMaintenanceModeInputSchema
>
export type UpdateSystemLogoInput = z.infer<typeof updateSystemLogoInputSchema>
