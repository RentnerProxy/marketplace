import { useMemo } from 'react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { NAVBAR_ITEMS } from '@/config/navbar.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    getDefaultRouteForPermissions,
    hasPermission,
} from '@/lib/Permissions/permissions.ts'
import { getVisibleNavigationItems } from '@/lib/Navigation/navigationItems.ts'
import type {
    AuthenticatedNavItem,
    AuthenticatedRoute,
} from '@/shared/Types/navigation.types.ts'

function getNavigationSubtitle(
    permissions: Array<string>,
    t: (key: string) => string,
) {
    if (permissions.some((permission) => permission.startsWith('admin.'))) {
        return t('nav.admin')
    }

    if (hasPermission(permissions, PERMISSIONS.USER_DASHBOARD)) {
        return t('nav.user')
    }

    return t('nav.navigation')
}

function getFirstNavRoute(
    navItems: Array<AuthenticatedNavItem>,
): AuthenticatedRoute | null {
    for (const item of navItems) {
        if (item.to) {
            return item.to
        }

        const childRoute = getFirstNavRoute(item.children ?? [])

        if (childRoute) {
            return childRoute
        }
    }

    return null
}

export default function useAuthenticatedNavigation(
    permissions: Array<string>,
    canSubmitMarketplaceApps = false,
) {
    const { t } = useTranslationStore()
    const subtitle = getNavigationSubtitle(permissions, t)

    const navigation = useMemo(() => {
        const visibleNavItems = getVisibleNavigationItems(
            NAVBAR_ITEMS.filter(
                (item: AuthenticatedNavItem) =>
                    !item.requiresVerifiedDeveloper || canSubmitMarketplaceApps,
            ),
            permissions,
        )

        return {
            homeTo:
                getFirstNavRoute(visibleNavItems) ??
                getDefaultRouteForPermissions(permissions),
            subtitle,
            visibleNavItems,
        }
    }, [permissions, subtitle, canSubmitMarketplaceApps])

    return { state: navigation }
}
