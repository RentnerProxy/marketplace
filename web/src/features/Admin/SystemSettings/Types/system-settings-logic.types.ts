import type { PendingMaintenanceExtensionRequest } from './types.ts'

export type UseMaintenanceSettingsParams = {
    currentMaintenanceStartsAt: string | null | undefined
    pendingMaintenanceExtensionRequest:
        PendingMaintenanceExtensionRequest | null | undefined
}
