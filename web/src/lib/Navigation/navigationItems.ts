import { hasPermission } from '@/lib/Permissions/permissions.ts'
import type { AuthenticatedNavItem } from '@/shared/Types/navigation.types.ts'

export function getVisibleNavigationItems(
    navItems: Array<AuthenticatedNavItem>,
    permissions: Array<string>,
    canSubmitMarketplaceApps = false,
): Array<AuthenticatedNavItem> {
    return navItems.flatMap((item) => {
        if (item.requiresVerifiedDeveloper && !canSubmitMarketplaceApps) {
            return []
        }
        const visibleChildren = getVisibleNavigationItems(
            item.children ?? [],
            permissions,
            canSubmitMarketplaceApps,
        )
        const canViewItem =
            !item.permission || hasPermission(permissions, item.permission)
        const hasVisibleChildren = visibleChildren.length > 0

        if (!canViewItem && !hasVisibleChildren) {
            return []
        }

        if (item.children && !item.to && !hasVisibleChildren) {
            return []
        }

        return [
            {
                ...item,
                children: hasVisibleChildren ? visibleChildren : undefined,
            },
        ]
    })
}
