import type { PendingMaintenanceExtensionRequest } from '@/server/Maintenance/Types/maintenance.types.ts'

export type SerializedPendingMaintenanceExtensionRequest = Omit<
    PendingMaintenanceExtensionRequest,
    'requestedAt'
> & {
    user: { id: string; username: string }
    requestedAt: string
}
