import { useMemo } from 'react'
import { flattenNavigationRoutes } from '@/lib/Navigation/navigationItems.ts'
import type { AuthenticatedNavItem } from '@/shared/Types/navigation.types.ts'

export default function useSidebarNavigationItems(
    navItems: Array<AuthenticatedNavItem>,
    isCollapsed: boolean,
) {
    const navigationItems = useMemo(
        () => (isCollapsed ? flattenNavigationRoutes(navItems) : navItems),
        [isCollapsed, navItems],
    )

    return {
        state: {
            navigationItems,
        },
    }
}
