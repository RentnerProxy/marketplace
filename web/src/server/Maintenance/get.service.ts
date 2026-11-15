import { db } from '@/db'
import { systemSettings } from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    getDefaultRouteForPermissions,
    hasPermission,
} from '@/lib/Permissions/permissions.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { getPendingMaintenanceExtensionRequest } from './requestStore.ts'
import { deriveMaintenanceState } from './state.service.ts'

async function getEnabledMaintenanceSettings() {
    const rows = await db.select().from(systemSettings).limit(1)
    const settings = rows.at(0)

    if (!settings?.isMaintenanceModeEnabled || !settings.maintenanceStartsAt) {
        return null
    }

    return settings
}

function getOwnPendingExtensionRequest(
    request: Awaited<ReturnType<typeof getPendingMaintenanceExtensionRequest>>,
    userId: string | undefined,
) {
    if (!request || request.userId !== userId) {
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

export async function getMaintenancePageStatusService() {
    const user = await getActiveCurrentSessionUser()
    const settings = await getEnabledMaintenanceSettings()
    const maintenanceState = deriveMaintenanceState(settings, new Date())
    const pendingRequest = await getPendingMaintenanceExtensionRequest()
    const ownPendingRequest = getOwnPendingExtensionRequest(
        pendingRequest,
        user?.id,
    )
    const permissionKeys = user ? await getUserPermissionKeys(user.id) : []
    const canBypassMaintenance = hasPermission(
        permissionKeys,
        PERMISSIONS.ADMIN_MAINTENANCE_BYPASS,
    )
    return {
        user: user
            ? {
                  id: user.id,
                  username: user.username,
                  email: user.email,
              }
            : null,
        isMaintenanceActive: maintenanceState.isActive,
        isMaintenanceScheduled: maintenanceState.isScheduled,
        maintenanceStartsAt: maintenanceState.startsAt,
        canBypassMaintenance,
        redirectTo: user
            ? getDefaultRouteForPermissions(permissionKeys)
            : '/login',
        canRequestExtension:
            Boolean(
                user && maintenanceState.isScheduled && !canBypassMaintenance,
            ) && !pendingRequest,
        pendingExtensionRequest: ownPendingRequest,
    }
}
