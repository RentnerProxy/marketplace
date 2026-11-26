import type { MaintenanceSettings } from './Types/maintenance.types.ts'
import { db } from '@/db'
import { systemSettings } from '@/db/schema.ts'

const maintenanceCacheTtlMs = 1_000

type MaintenanceCache = {
    value?: { settings: MaintenanceSettings | undefined; readAt: number }
    pending?: ReturnType<typeof readMaintenanceSettings>
}

let maintenanceCache: MaintenanceCache = {}

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

async function readMaintenanceSettings() {
    const settingsRows = await db
        .select({
            isMaintenanceModeEnabled: systemSettings.isMaintenanceModeEnabled,
            maintenanceStartsAt: systemSettings.maintenanceStartsAt,
        })
        .from(systemSettings)
        .limit(1)

    return settingsRows.at(0)
}

export function invalidateMaintenanceStateService() {
    maintenanceCache = {}
}

// Access checks require the database even when realtime invalidation is delayed.
export async function getFreshMaintenanceStateService() {
    const settings = await readMaintenanceSettings()
    return deriveMaintenanceState(settings, new Date())
}

export async function getMaintenanceStateService(): Promise<
    ReturnType<typeof deriveMaintenanceState>
> {
    const cache = maintenanceCache
    const readAt = Date.now()
    if (cache.value) {
        const age = readAt - cache.value.readAt
        if (age >= 0 && age < maintenanceCacheTtlMs) {
            return deriveMaintenanceState(cache.value.settings, new Date())
        }
    }

    const pending = (cache.pending ??= readMaintenanceSettings()
        .then(function (settings) {
            cache.value = { settings, readAt }
            return settings
        })
        .finally(function () {
            delete cache.pending
        }))
    const settings = await pending
    if (cache !== maintenanceCache) {
        return getMaintenanceStateService()
    }
    return deriveMaintenanceState(settings, new Date())
}

export async function publishMaintenanceStateService(
    settings: MaintenanceSettings,
    updatedAt: Date,
) {
    const state = deriveMaintenanceState(settings, updatedAt)

    const { publishMaintenanceModeChangedService } =
        await import('@/server/Realtime/publish.service.ts')
    await publishMaintenanceModeChangedService({
        isMaintenanceModeEnabled: settings.isMaintenanceModeEnabled,
        isMaintenanceModeActive: state.isActive,
        isMaintenanceModeScheduled: state.isScheduled,
        maintenanceStartsAt: state.startsAt,
        updatedAt: updatedAt.toISOString(),
    })
}
