import type { SerializedPendingMaintenanceExtensionRequest } from './Types/system-settings.types.ts'
import { getSystemLogoPublicImagePaths } from '@/lib/Images/publicImagePaths.ts'
import { deriveMaintenanceState } from '@/server/Maintenance/state.service.ts'
import { getPendingMaintenanceExtensionRequest } from '@/server/Maintenance/requestStore.ts'

import { getOrCreateSystemSettingsService } from './settings.service.ts'

export function getVersion(value: Date | null) {
    return value?.getTime() ?? 0
}

async function getPendingExtensionRequest(): Promise<SerializedPendingMaintenanceExtensionRequest | null> {
    const request = await getPendingMaintenanceExtensionRequest()

    if (!request) {
        return null
    }

    return {
        ...request,
        user: {
            id: request.userId,
            username: request.username,
        },
        requestedAt: request.requestedAt.toISOString(),
    }
}

async function getPublicSystemSettings() {
    const settings = await getOrCreateSystemSettingsService()
    const paths = getSystemLogoPublicImagePaths()
    const version = getVersion(settings.logoUpdatedAt)
    const maintenanceState = deriveMaintenanceState(settings, new Date())

    return {
        companyName: settings.companyName,
        logoSrc: version
            ? `${paths.relativeLarge}?v=${version}`
            : '/images/default.webp',
        logoSrc64: version
            ? `${paths.relativeSmall}?v=${version}`
            : '/images/default.webp',
        faviconSrc: version
            ? `${paths.relativeFavicon}?v=${version}`
            : '/favicon.ico',
        isPublicRegistrationEnabled: settings.isPublicRegistrationEnabled,
        isMaintenanceModeEnabled: settings.isMaintenanceModeEnabled,
        isMaintenanceModeActive: maintenanceState.isActive,
        isMaintenanceModeScheduled: maintenanceState.isScheduled,
        maintenanceStartsAt: maintenanceState.startsAt,
    }
}

export async function getPublicSystemSettingsService() {
    return {
        ...(await getPublicSystemSettings()),
        pendingMaintenanceExtensionRequest:
            null as SerializedPendingMaintenanceExtensionRequest | null,
    }
}

export async function getSystemSettingsService() {
    return {
        ...(await getPublicSystemSettings()),
        pendingMaintenanceExtensionRequest: await getPendingExtensionRequest(),
    }
}
