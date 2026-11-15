import type { AuthenticatedTopbarLogicReturn } from '../Types/authenticated-layout-logic.types.ts'
import { useRouterState } from '@tanstack/react-router'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { NAVBAR_ITEMS } from '@/config/navbar.config.ts'
import type { AuthenticatedNavItem } from '@/shared/Types/navigation.types.ts'

function findNavigationItem(
    items: Array<AuthenticatedNavItem>,
    pathname: string,
): AuthenticatedNavItem | null {
    for (const item of items) {
        if (item.to === pathname) {
            return item
        }

        const child = findNavigationItem(item.children ?? [], pathname)

        if (child) {
            return child
        }
    }

    return null
}

export default function useAuthenticatedTopbarLogic(): AuthenticatedTopbarLogicReturn {
    const { t } = useTranslationStore()
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })
    const navigationItem = findNavigationItem(NAVBAR_ITEMS, pathname)

    return {
        state: {
            title: t(navigationItem?.title ?? 'layout.topbar.defaultTitle'),
            description: t(
                navigationItem?.description ??
                    'layout.topbar.defaultDescription',
            ),
        },
    }
}
