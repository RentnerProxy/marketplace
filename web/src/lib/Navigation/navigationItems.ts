import { hasPermission } from '@/lib/Permissions/permissions.ts'
import type { AuthenticatedNavItem } from '@/shared/Types/navigation.types.ts'

export function getVisibleNavigationItems(
    navItems: Array<AuthenticatedNavItem>,
    permissions: Array<string>,
): Array<AuthenticatedNavItem> {
    return navItems.flatMap((item) => {
        const visibleChildren = getVisibleNavigationItems(
            item.children ?? [],
            permissions,
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

export function flattenNavigationRoutes(
    navItems: Array<AuthenticatedNavItem>,
): Array<AuthenticatedNavItem> {
    return navItems.flatMap((item) => [
        ...(item.to ? [{ ...item, children: undefined }] : []),
        ...flattenNavigationRoutes(item.children ?? []),
    ])
}
