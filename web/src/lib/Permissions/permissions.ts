import { withoutSuperUserPermission } from './permissionCollections.ts'
import {
    DEFAULT_ROUTE_PRIORITY,
    ROUTE_PERMISSIONS,
} from '@/config/routes.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/shared/Types/config.types.ts'

export const SUPER_USER_PERMISSION = PERMISSIONS.ADMIN_SUPER_USER

export function hasPermission(
    permissions: Array<string> | undefined,
    permission: PermissionKey,
) {
    return Boolean(permissions?.includes(permission))
}

export function hasSuperUserPermission(permissions: Array<string>) {
    return hasPermission(permissions, SUPER_USER_PERMISSION)
}

export function getVisiblePermissionKeys(
    permissions: Array<string>,
    canManageSuperUsers: boolean,
) {
    if (canManageSuperUsers) {
        return permissions
    }

    return withoutSuperUserPermission(permissions)
}

export function getDefaultRouteForPermissions(permissions: Array<string>) {
    for (const routeConfig of DEFAULT_ROUTE_PRIORITY) {
        if (hasPermission(permissions, routeConfig.permission)) {
            return routeConfig.route
        }
    }

    const accessibleRoute = Object.entries(ROUTE_PERMISSIONS).find(function ([
        ,
        permission,
    ]) {
        return hasPermission(permissions, permission)
    })

    const route = accessibleRoute?.[0]
    return route && isConfiguredRoute(route) ? route : '/login'
}

function isConfiguredRoute(
    route: string,
): route is keyof typeof ROUTE_PERMISSIONS {
    return Object.hasOwn(ROUTE_PERMISSIONS, route)
}

export function getPermissionForRoute(
    pathname: string,
): PermissionKey | undefined {
    const route = normalizePathname(pathname)
    return isConfiguredRoute(route) ? ROUTE_PERMISSIONS[route] : undefined
}

function normalizePathname(pathname: string) {
    const pathWithoutSearch = pathname.split('?')[0]?.split('#')[0] ?? '/'

    if (pathWithoutSearch.length > 1 && pathWithoutSearch.endsWith('/')) {
        return pathWithoutSearch.slice(0, -1)
    }

    return pathWithoutSearch
}
