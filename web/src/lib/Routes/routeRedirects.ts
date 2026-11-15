import type { LoginRedirectReason } from './Types/route-redirect.types.ts'
import { redirect } from '@tanstack/react-router'
import {
    getDefaultRouteForPermissions,
    getPermissionForRoute,
    hasPermission,
} from '@/lib/Permissions/permissions.ts'

export function redirectPublicRouteForSetupStatus(
    isSetupRequired: boolean,
    pathname: string,
) {
    if (isSetupRequired && pathname !== '/setup') {
        throw redirect({ to: '/setup' })
    }

    if (!isSetupRequired && pathname === '/setup') {
        throw redirect({ to: '/login' })
    }
}

export function redirectSetupRouteForSetupStatus(
    isSetupRequired: boolean,
    pathname: string,
) {
    if (!isSetupRequired && pathname === '/setup') {
        throw redirect({ to: '/login' })
    }
}

export function getLoginRedirectReason(
    hash: string,
): LoginRedirectReason | undefined {
    const reason = hash.replace(/^#/, '')

    if (
        reason === 'password-reset-token-missing' ||
        reason === 'password-reset-token-invalid'
    ) {
        return reason
    }

    return undefined
}

export function redirectWhenMissingConfiguredPermission(
    pathname: string,
    permissions: Array<string> = [],
) {
    const permission = getPermissionForRoute(pathname)

    if (permission && !hasPermission(permissions, permission)) {
        throw redirect({
            to: getDefaultRouteForPermissions(permissions),
        })
    }
}
