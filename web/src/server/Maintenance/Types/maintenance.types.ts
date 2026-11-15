import type { systemSettings } from '@/db/schema.ts'

export type MaintenanceSettings = Pick<
    typeof systemSettings.$inferSelect,
    'isMaintenanceModeEnabled' | 'maintenanceStartsAt'
>

export type PendingMaintenanceExtensionRequest = {
    id: string
    userId: string
    username: string
    reason: string
    requestedAt: Date
}
