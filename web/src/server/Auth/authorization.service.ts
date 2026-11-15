import type { PermissionKey } from '@/shared/Types/config.types.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { getUserPermissionKeys } from '@/lib/Permissions/userPermissions.ts'
import { requireMaintenanceAccessService } from '@/server/Maintenance/access.service.ts'
import { getActiveCurrentSessionUser } from './currentSession.ts'
import {
    AuthenticationRequiredError,
    PermissionDeniedError,
} from './authorization.errors.ts'

async function getAuthenticatedAccess() {
    const sessionUser = await getActiveCurrentSessionUser()

    if (!sessionUser) {
        throw new AuthenticationRequiredError()
    }

    const permissionKeys = await getUserPermissionKeys(sessionUser.id)
    return { permissionKeys, sessionUser }
}

async function getRequiredPermissionAccess(permission: PermissionKey) {
    const access = await getAuthenticatedAccess()

    if (!hasPermission(access.permissionKeys, permission)) {
        throw new PermissionDeniedError()
    }

    await requireMaintenanceAccessService(access.permissionKeys)
    return access
}

export async function requireAuthenticatedFeatureAccessService() {
    const access = await getAuthenticatedAccess()
    await requireMaintenanceAccessService(access.permissionKeys)
    return access
}

export async function requirePermissionService(permission: PermissionKey) {
    const { permissionKeys, sessionUser } =
        await getRequiredPermissionAccess(permission)

    return {
        userId: sessionUser.id,
        permissionKeys,
    }
}

export async function requirePermissionWithSessionService(
    permission: PermissionKey,
) {
    const { permissionKeys, sessionUser } =
        await getRequiredPermissionAccess(permission)

    return {
        userId: sessionUser.id,
        permissionKeys,
        sessionExpiresAt: sessionUser.expiresAt,
        sessionHash: sessionUser.sessionHash,
    }
}
