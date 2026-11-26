import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    getDefaultRouteForPermissions,
    hasPermission,
} from '@/lib/Permissions/permissions.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { getActiveCurrentSessionUser } from '@/server/Auth/currentSession.ts'
import { getPendingMaintenanceExtensionRequest } from './requestStore.ts'
import { getMaintenanceStateService } from './state.service.ts'

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
    const currentUser = getActiveCurrentSessionUser()
    const [user, maintenanceState, pendingRequest, permissionKeys] =
        await Promise.all([
            currentUser,
            getMaintenanceStateService(),
            getPendingMaintenanceExtensionRequest(),
            currentUser.then((current) =>
                current ? getUserPermissionKeys(current.id) : [],
            ),
        ])
    const ownPendingRequest = getOwnPendingExtensionRequest(
        pendingRequest,
        user?.id,
    )
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
        maintenanceStartsAt:
            maintenanceState.isActive || maintenanceState.isScheduled
                ? maintenanceState.startsAt
                : null,
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
