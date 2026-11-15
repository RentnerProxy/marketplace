import type { MaintenanceSettings } from './Types/maintenance.types.ts'
import { db } from '@/db'
import { systemSettings } from '@/db/schema.ts'
import { publishMaintenanceModeChangedService } from '@/server/Realtime/publish.service.ts'

export function deriveMaintenanceState(
    settings: MaintenanceSettings | null | undefined,
    now: Date,
) {
    const maintenanceStartsAt = settings?.maintenanceStartsAt ?? null
    const isMaintenanceModeEnabled = settings?.isMaintenanceModeEnabled ?? false

    return {
        isActive: Boolean(
            isMaintenanceModeEnabled &&
            maintenanceStartsAt &&
            maintenanceStartsAt <= now,
        ),
        isScheduled: Boolean(
            isMaintenanceModeEnabled &&
            maintenanceStartsAt &&
            maintenanceStartsAt > now,
        ),
        startsAt: maintenanceStartsAt?.toISOString() ?? null,
    }
}

export async function getMaintenanceStateService() {
    const settingsRows = await db.select().from(systemSettings).limit(1)

    return deriveMaintenanceState(settingsRows.at(0), new Date())
}

export async function publishMaintenanceStateService(
    settings: MaintenanceSettings,
    updatedAt: Date,
) {
    const state = deriveMaintenanceState(settings, updatedAt)

    await publishMaintenanceModeChangedService({
        isMaintenanceModeEnabled: settings.isMaintenanceModeEnabled,
        isMaintenanceModeActive: state.isActive,
        isMaintenanceModeScheduled: state.isScheduled,
        maintenanceStartsAt: state.startsAt,
        updatedAt: updatedAt.toISOString(),
    })
}
